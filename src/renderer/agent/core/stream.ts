/**
 * Stream processing for assistant responses.
 * Collects text, reasoning, and tool-call events and resolves a final result.
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useStore } from '@store'
import { EventBus } from './EventBus'
import { getErrorMessage, ErrorCode } from '@shared/utils/errorHandler'
import type { ToolCall, TokenUsage } from '../types'
import type { LLMCallResult } from './types'
import { filterToolCallLeakChunk } from '../utils/toolCallLeakFilter'
import { t } from '@/renderer/i18n'
import { StreamingEditPreviewCoordinator } from '../services/streamingEditPreview'
import {
  arePartialArgsEqual,
  parseFinalJsonArgs,
  parsePartialJsonArgs,
} from './toolArgumentStreamParser'

// Tracks active IPC listeners for leak debugging.
let activeListenerCount = 0

export function getActiveListenerCount(): number {
  return activeListenerCount
}

// ===== Stream Processor =====

export interface StreamProcessor {
  wait: () => Promise<LLMCallResult>
  cleanup: () => void
}

export function createStreamProcessor(
  assistantId: string | null,
  store: import('../store/AgentStore').ThreadBoundStore,
  requestId: string,
  options?: {
    allowToolCalls?: boolean
  }
): StreamProcessor {
  const allowToolCalls = options?.allowToolCalls ?? true

  let content = ''
  let reasoning = ''
  let isInReasoning = false
  let reasoningPartId: string | null = null
  let toolCalls: ToolCall[] = []
  let usage: TokenUsage | undefined
  let error: string | undefined
  let isCleanedUp = false
  let filteredToolMarkupBuffer = ''

  const streamingToolCalls = new Map<string, {
    id: string
    name: string
    argsString: string
    lastPreviewArgs?: Record<string, unknown>
  }>()
  const streamingEditPreviewCoordinator = new StreamingEditPreviewCoordinator()

  let toolUpdateRafId: number | null = null
  const pendingToolPreviewUpdates = new Map<string, {
    partialArgs?: Record<string, unknown>
    name?: string
    timestamp: number
  }>()

  // Cleanup callbacks for request-scoped listeners.
  const cleanups: (() => void)[] = []

  const flushToolPreviewUpdates = () => {
    if (toolUpdateRafId !== null) {
      clearTimeout(toolUpdateRafId)
      toolUpdateRafId = null
    }

    if (!assistantId || pendingToolPreviewUpdates.size === 0) return

    for (const [toolId, update] of pendingToolPreviewUpdates) {
      store.setToolStreamingPreview(toolId, {
        isStreaming: true,
        ...(update.partialArgs ? { partialArgs: update.partialArgs } : {}),
        ...(update.name ? { name: update.name } : {}),
        lastUpdateTime: update.timestamp,
      })
    }

    pendingToolPreviewUpdates.clear()
  }

  const scheduleToolPreviewUpdates = () => {
    if (toolUpdateRafId !== null) return

    // 降低工具预览更新频率，避免频繁触发状态更新
    toolUpdateRafId = window.setTimeout(() => {
      toolUpdateRafId = null
      flushToolPreviewUpdates()
    }, 150) as unknown as number
  }

  const queueToolPreviewUpdate = (
    toolId: string,
    update: {
      partialArgs?: Record<string, unknown>
      name?: string
      timestamp: number
    }
  ) => {
    const current = pendingToolPreviewUpdates.get(toolId)
    pendingToolPreviewUpdates.set(toolId, {
      ...current,
      ...update,
      timestamp: update.timestamp,
    })
    scheduleToolPreviewUpdates()
  }

  const syncStreamingEditPreview = async (toolId: string, toolName: string, partialArgs?: Record<string, unknown>) => {
    await streamingEditPreviewCoordinator.sync(
      toolId,
      toolName,
      partialArgs,
      useStore.getState().workspacePath
    )
  }

  const cleanup = () => {
    if (isCleanedUp) return
    isCleanedUp = true

    if (toolUpdateRafId !== null) {
      clearTimeout(toolUpdateRafId)
      toolUpdateRafId = null
    }
    pendingToolPreviewUpdates.clear()
    streamingEditPreviewCoordinator.releaseAll()

    for (const fn of cleanups) {
      try {
        fn()
        activeListenerCount--
      } catch (err) {
        logger.agent.error('[StreamProcessor] Cleanup error:', err)
      }
    }
    cleanups.length = 0
    logger.agent.info('[StreamProcessor] Active listeners remaining:', activeListenerCount)
  }

  const handleStream = (data: {
    type: string
    content?: string
    id?: string
    name?: string
    arguments?: unknown
    argumentsDelta?: string
    usage?: unknown
  }) => {
    switch (data.type) {
      case 'text':
        if (data.content) {
          const filtered = filterToolCallLeakChunk(data.content, filteredToolMarkupBuffer)
          const visibleChunk = filtered.visibleText
          filteredToolMarkupBuffer = filtered.buffer

          if (isInReasoning && assistantId && reasoningPartId) {
            store.finalizeReasoningPart(assistantId, reasoningPartId)
            EventBus.emit({ type: 'stream:reasoning', text: '', phase: 'end' })
            isInReasoning = false
          }

          content += visibleChunk
          if (assistantId && visibleChunk) {
            store.appendToAssistant(assistantId, visibleChunk)
          }
          if (visibleChunk) {
            EventBus.emit({ type: 'stream:text', text: visibleChunk })
          }
        }
        break

      case 'reasoning': {
        const reasoningContent = data.content
        if (reasoningContent) {
          if (!isInReasoning) {
            isInReasoning = true
            if (assistantId) {
              reasoningPartId = store.addReasoningPart(assistantId)
              store.updateMessage(assistantId, {
                reasoningStartTime: Date.now(),
              } as Partial<import('../types').AssistantMessage>)
            }
            EventBus.emit({ type: 'stream:reasoning', text: '', phase: 'start' })
          }
          reasoning += reasoningContent
          if (assistantId && reasoningPartId) {
            store.updateReasoningPart(assistantId, reasoningPartId, reasoningContent, true)
            store.updateMessage(assistantId, {
              reasoning,
            } as Partial<import('../types').AssistantMessage>)
          }
          EventBus.emit({ type: 'stream:reasoning', text: reasoningContent, phase: 'delta' })
        }
        break
      }

      case 'tool_call_start': {
        if (!allowToolCalls) {
          break
        }

        const toolId = data.id || `tool-${Date.now()}`
        const toolName = data.name || '...'

        if (isInReasoning && assistantId && reasoningPartId) {
          store.finalizeReasoningPart(assistantId, reasoningPartId)
          EventBus.emit({ type: 'stream:reasoning', text: '', phase: 'end' })
          isInReasoning = false
        }

        streamingToolCalls.set(toolId, {
          id: toolId,
          name: toolName,
          argsString: '',
        })

        if (assistantId) {
          store.setToolStreamingPreview(toolId, {
            isStreaming: true,
            name: toolName,
            lastUpdateTime: Date.now(),
          })
        }
        EventBus.emit({ type: 'stream:tool_start', id: toolId, name: toolName })
        break
      }

      case 'tool_call_delta': {
        if (!allowToolCalls) {
          break
        }

        const tcId = data.id
        const argsDelta = data.argumentsDelta

        if (tcId) {
          const tc = streamingToolCalls.get(tcId)
          if (tc) {
            if (argsDelta) {
              tc.argsString += argsDelta

              if (assistantId) {
                const partialArgs = parsePartialJsonArgs(tc.argsString)
                if (partialArgs && Object.keys(partialArgs).length > 0) {
                  if (!arePartialArgsEqual(tc.lastPreviewArgs, partialArgs)) {
                    tc.lastPreviewArgs = partialArgs
                    queueToolPreviewUpdate(tc.id, {
                      partialArgs,
                      timestamp: Date.now(),
                    })
                    void syncStreamingEditPreview(tc.id, tc.name, partialArgs)
                  }
                }
              }
            }
            if (data.name && data.name !== tc.name) {
              tc.name = data.name
              if (assistantId) {
                queueToolPreviewUpdate(tc.id, {
                  name: data.name,
                  timestamp: Date.now(),
                })
              }
            }
            EventBus.emit({ type: 'stream:tool_delta', id: tc.id, args: tc.argsString })
          }
        }
        break
      }

      case 'tool_call_delta_end': {
        if (!allowToolCalls) {
          break
        }

        const tcId = data.id
        if (tcId && assistantId) {
          const tc = streamingToolCalls.get(tcId)
          if (tc) {
            flushToolPreviewUpdates()
            const finalArgs = parseFinalJsonArgs(tc.argsString) || {}
            void syncStreamingEditPreview(tc.id, tc.name, finalArgs)
            if (finalArgs) {
              store.updateToolCall(assistantId, tc.id, {
                arguments: finalArgs,
                streamingState: undefined,
              })
            }

            const toolCall: ToolCall = {
              id: tc.id,
              name: tc.name,
              arguments: finalArgs,
              status: 'pending',
            }

            // Avoid duplicate tool calls in the final array.
            if (!toolCalls.find(t => t.id === tc.id)) {
              toolCalls.push(toolCall)
            }
          }
        }
        break
      }

      case 'tool_call_available': {
        if (!allowToolCalls) {
          break
        }

        const tcId = data.id || ''
        const toolName = data.name || ''
        const args = data.arguments as Record<string, unknown>

        if (tcId) {
          flushToolPreviewUpdates()
          streamingToolCalls.delete(tcId)
        }

        const toolCall: ToolCall = {
          id: tcId,
          name: toolName,
          arguments: args,
          status: 'pending',
        }

        // Avoid duplicate tool calls in the final array.
        if (!toolCalls.find(tc => tc.id === tcId)) {
          toolCalls.push(toolCall)
        }

        if (assistantId && tcId) {
          store.setToolStreamingPreview(tcId, {
            isStreaming: true,
            name: toolName,
            partialArgs: args,
            lastUpdateTime: Date.now(),
          })
        }

        void syncStreamingEditPreview(tcId, toolName, args)

        EventBus.emit({ type: 'stream:tool_available', id: tcId, name: toolName, args })
        break
      }

      case 'usage':
        if (data.usage) {
          usage = data.usage as TokenUsage
        }
        break
    }
  }

  const finalizeReasoning = () => {
    if (isInReasoning) {
      if (assistantId && reasoningPartId) {
        store.finalizeReasoningPart(assistantId, reasoningPartId)
      }
      EventBus.emit({ type: 'stream:reasoning', text: '', phase: 'end' })
      isInReasoning = false
    }
  }

  // Promise resolver is hoisted to avoid listener registration races.
  let resolveWait: ((result: LLMCallResult) => void) | null = null
  let isResolved = false

  const waitPromise = new Promise<LLMCallResult>((resolve) => {
    resolveWait = resolve
  })

  const doResolve = (result: LLMCallResult) => {
    if (isResolved) return
    isResolved = true

    if (resolveWait) {
      resolveWait(result)
    }

    cleanup()
  }

  // Handle request error.
  const handleError = (err: { message?: string; code?: string } | string) => {
    let errorMsg: string

    if (typeof err === 'string') {
      errorMsg = err
    } else {
      if (err.code && err.code in ErrorCode) {
        const language = useStore.getState().language
        const baseMsg = getErrorMessage(err.code as ErrorCode, language)
        errorMsg = err.message ? `${baseMsg}: ${err.message}` : baseMsg
      } else {
        const language = useStore.getState().language as 'en' | 'zh'
        errorMsg = err.message || t('error.unknown', language)
      }
    }

    logger.agent.error('[StreamProcessor] Error:', errorMsg)
    error = errorMsg
    finalizeReasoning()
    doResolve({ content, toolCalls, usage, error: errorMsg })
  }

  const handleDone = (result: { reasoning?: string; usage?: unknown }) => {
    if (result?.usage) {
      usage = result.usage as TokenUsage
    }
    if (typeof result?.reasoning === 'string' && result.reasoning.length >= reasoning.length) {
      const missingReasoning = result.reasoning.slice(reasoning.length)
      reasoning = result.reasoning

      if (assistantId && missingReasoning && reasoningPartId) {
        store.updateReasoningPart(assistantId, reasoningPartId, missingReasoning, true)
      }

      if (assistantId) {
        store.updateMessage(assistantId, {
          reasoning,
        } as Partial<import('../types').AssistantMessage>)
      }
    }
    flushToolPreviewUpdates()

    // `llm:done:*` and `llm:stream:*` are delivered on different IPC channels.
    // Give any in-flight final tool-call event one tick to arrive before resolving.
    window.setTimeout(() => {
      finalizeReasoning()
      doResolve({ content, reasoning, toolCalls, usage, error })
    }, 0)
  }

  // Subscribe only to this request's IPC channel.
  const unsubStream = api.llm.onStream(requestId, handleStream)
  const unsubError = api.llm.onError(requestId, handleError)
  const unsubDone = api.llm.onDone(requestId, handleDone)

  cleanups.push(unsubStream, unsubError, unsubDone)
  activeListenerCount += 3

  // Expose the already-created completion promise.
  const wait = (): Promise<LLMCallResult> => waitPromise

  return { wait, cleanup }
}
