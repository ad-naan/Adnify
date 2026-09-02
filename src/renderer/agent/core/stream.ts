/**
 * Stream processing for assistant responses.
 * Collects text, reasoning, and tool-call events and resolves a final result.
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useStore } from '@store'
import { EventBus } from './EventBus'
import { getErrorMessage, ErrorCode } from '@shared/utils/errorHandler'
import { tryProviderAuthErrorText } from '@shared/errors/providerAuthError'
import type { ToolCall, TokenUsage } from '../types'
import type { LLMCallResult } from './types'
import { ToolCallLeakFilter } from '../utils/toolCallLeakFilter'
import { t } from '@shared/i18n'
import { StreamingEditPreviewCoordinator } from '../services/streamingEditPreview'
import type { LLMResponseMetadata, LLMStreamSource, RendererStreamChunk } from '@/shared/types/llm'
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
  let reasoningSignature: string | undefined
  let isInReasoning = false
  let reasoningPartId: string | null = null
  let toolCalls: ToolCall[] = []
  let sources: LLMStreamSource[] = []
  let usage: TokenUsage | undefined
  let metadata: LLMResponseMetadata | undefined
  let error: string | undefined
  let isCleanedUp = false
  const toolCallLeakFilter = new ToolCallLeakFilter()

  const streamingToolCalls = new Map<string, {
    id: string
    name: string
    argsString: string
    lastPreviewArgs?: Record<string, unknown>
  }>()
  const streamingEditPreviewCoordinator = new StreamingEditPreviewCoordinator()

  // Cleanup callbacks for request-scoped listeners.
  const cleanups: (() => void)[] = []

  const syncStreamingEditPreview = async (toolId: string, toolName: string, partialArgs?: Record<string, unknown>) => {
    await streamingEditPreviewCoordinator.sync(
      toolId,
      toolName,
      partialArgs,
      useStore.getState().workspacePath
    )
  }

  const publishVisibleText = (visibleChunk: string) => {
    if (!visibleChunk) return
    content += visibleChunk
    if (assistantId) store.appendToAssistant(assistantId, visibleChunk)
    EventBus.emit({ type: 'stream:text', text: visibleChunk })
  }

  const cleanup = () => {
    if (isCleanedUp) return
    isCleanedUp = true

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

  const handleStream = (data: RendererStreamChunk) => {
    switch (data.type) {
      case 'text':
        if (data.content) {
          const visibleChunk = toolCallLeakFilter.consume(data.content)

          if (isInReasoning && assistantId && reasoningPartId) {
            store.finalizeReasoningPart(assistantId, reasoningPartId)
            EventBus.emit({ type: 'stream:reasoning', text: '', phase: 'end' })
            isInReasoning = false
          }

          publishVisibleText(visibleChunk)
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
            // Only the buffered part update runs per delta. The mirrored
            // `message.reasoning` field is written once when the stream settles
            // (loop.ts) — updating it here cost a full messages.map() plus a
            // threads clone on every token, unthrottled, and nothing renders it.
            store.updateReasoningPart(assistantId, reasoningPartId, reasoningContent, true)
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
                    void syncStreamingEditPreview(tc.id, tc.name, partialArgs)
                  }
                }
              }
            }
            if (data.name && data.name !== tc.name) {
              tc.name = data.name
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
            const finalArgs = parseFinalJsonArgs(tc.argsString)
            if (finalArgs) {
              void syncStreamingEditPreview(tc.id, tc.name, finalArgs)
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

        if (tcId) streamingToolCalls.delete(tcId)

        const toolCall: ToolCall = {
          id: tcId,
          name: toolName,
          arguments: args,
          status: 'pending',
        }

        // The available event is authoritative. Some providers omit argument
        // deltas and only deliver the complete payload here, so replace any
        // compatibility fallback with these final arguments.
        const existingIndex = toolCalls.findIndex(tc => tc.id === tcId)
        if (existingIndex >= 0) {
          toolCalls[existingIndex] = toolCall
        } else {
          toolCalls.push(toolCall)
        }

        void syncStreamingEditPreview(tcId, toolName, args)

        EventBus.emit({ type: 'stream:tool_available', id: tcId, name: toolName, args })
        break
      }

      case 'source':
        if (data.source) {
          sources.push(data.source)
          if (assistantId) {
            store.upsertSourcesPart(assistantId, data.source)
          }
        }
        break

      default: {
        // 以前这里什么都没有：主进程新增或改名一个事件类型，渲染端会静默丢弃它，
        // 而类型检查全绿——工具调用整个消失就是这么发生的。现在类型上已经不可能
        // 走到这里（RendererStreamChunk 是判别联合），留下这条日志是为了兜住
        // 「主进程版本比渲染端新」的热更新窗口。
        const unknownChunk: never = data
        logger.agent.warn('[StreamProcessor] Unknown stream chunk type, dropped:', unknownChunk)
        break
      }
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
    const language = useStore.getState().language
    const rawMessage = typeof err === 'string' ? err : err.message
    let errorMsg: string

    // 供应商鉴权类错误的文案键编在 message 里（主进程没有界面语言），认出来就直接用它：
    // 它的 code 一路走到这里是 `UNKNOWN`，套上通用前缀只会变成"发生未知错误: <具体原因>"。
    const authText = tryProviderAuthErrorText(rawMessage, language)
    if (authText) {
      errorMsg = authText
    } else if (typeof err === 'string') {
      errorMsg = err
    } else {
      if (err.code && err.code in ErrorCode) {
        const baseMsg = getErrorMessage(err.code as ErrorCode, language)
        errorMsg = err.message ? `${baseMsg}: ${err.message}` : baseMsg
      } else {
        errorMsg = err.message || t('error.unknown', language)
      }
    }

    logger.agent.error('[StreamProcessor] Error:', errorMsg)
    error = errorMsg
    publishVisibleText(toolCallLeakFilter.finalize())
    finalizeReasoning()
    doResolve({ content, toolCalls, sources, usage, error: errorMsg })
  }

  const handleDone = (result: { reasoning?: string; reasoningSignature?: string; usage?: unknown; metadata?: LLMResponseMetadata }) => {
    if (result?.usage) {
      usage = result.usage as TokenUsage
    }
    if (result?.metadata) {
      metadata = result.metadata
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
    if (result?.reasoningSignature) {
      reasoningSignature = result.reasoningSignature
    }
    // `llm:done:*` and `llm:stream:*` are delivered on different IPC channels.
    // Give any in-flight final tool-call event one tick to arrive before resolving.
    window.setTimeout(() => {
      publishVisibleText(toolCallLeakFilter.finalize())

      // Compatibility fallback for providers that stream a complete argument
      // object but never emit tool_call_available. Never promote an empty or
      // malformed payload into an executable call.
      for (const tc of streamingToolCalls.values()) {
        if (toolCalls.some(toolCall => toolCall.id === tc.id)) continue
        const finalArgs = parseFinalJsonArgs(tc.argsString)
        if (!finalArgs || Object.keys(finalArgs).length === 0) continue
        toolCalls.push({
          id: tc.id,
          name: tc.name,
          arguments: finalArgs,
          status: 'pending',
        })
      }

      finalizeReasoning()
      doResolve({ content, reasoning, reasoningSignature, toolCalls, sources, usage, metadata, error })
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
