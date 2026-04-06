/**
 * 流式服务 - 使用 AI SDK 6.0 streamText
 * AI SDK 6.0 原生支持所有主流模型的 reasoning，只需处理特殊格式（如 MiniMax XML 标签）
 */

import { streamText } from 'ai'
import type { StreamTextResult } from 'ai'
import { BrowserWindow } from 'electron'
import { logger } from '@shared/utils/Logger'
import { ErrorCode } from '@shared/utils/errorHandler'
import { createModel, resolveHeaderPlaceholders } from '../modelFactory'
import { MessageConverter } from '../core/MessageConverter'
import { ToolConverter } from '../core/ToolConverter'
import { prepareRequestCache } from '../core/RequestCache'
import {
  detectUnsupportedCacheFeature,
  getCacheFeatureErrorReason,
  markCacheFeatureUnsupported,
} from '../core/CacheCompatibility'
import { LLMError, convertUsage } from '../types'
import type { StreamEvent, TokenUsage, ResponseMetadata } from '../types'
import type { LLMConfig, LLMMessage, ToolDefinition } from '@shared/types'
import { ThinkingStrategyFactory, type ThinkingStrategy } from '../strategies/ThinkingStrategy'

export interface StreamingParams {
  config: LLMConfig
  messages: LLMMessage[]
  tools?: ToolDefinition[]
  systemPrompt?: string
  abortSignal?: AbortSignal
  activeTools?: string[]
  requestId: string  // 必传，用于 IPC 频道隔离
}

export interface StreamingResult {
  content: string
  reasoning?: string
  usage?: TokenUsage
  metadata?: ResponseMetadata
}

interface StreamingRecoveryState {
  cacheRetryCount: number
}

const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 15_000

function resolveStreamIdleTimeoutMs(config: LLMConfig): number {
  if (typeof config.timeout === 'number' && Number.isFinite(config.timeout) && config.timeout > 0) {
    return config.timeout
  }

  return DEFAULT_STREAM_IDLE_TIMEOUT_MS
}

export class StreamingService {
  private window: BrowserWindow
  private messageConverter: MessageConverter
  private toolConverter: ToolConverter
  // IPC 批量发送缓冲区
  private eventBuffer = new Map<string, StreamEvent[]>()
  private flushTimers = new Map<string, NodeJS.Timeout>()

  constructor(window: BrowserWindow) {
    this.window = window
    this.messageConverter = new MessageConverter()
    this.toolConverter = new ToolConverter()
  }

  /**
   * 流式生成文本
   */
  async generate(params: StreamingParams): Promise<StreamingResult> {
    return this.generateWithRecovery(params, {
      cacheRetryCount: 0,
    })
  }

  private async generateWithRecovery(
    params: StreamingParams,
    recoveryState: StreamingRecoveryState
  ): Promise<StreamingResult> {
    const { config, messages, tools, systemPrompt, abortSignal, activeTools, requestId } = params

    // 创建 thinking 策略（只为需要特殊处理的模型）
    const strategy = ThinkingStrategyFactory.create(config.model)
    strategy.reset?.()

    logger.system.info('[StreamingService] Starting generation', {
      provider: config.provider,
      model: config.model,
      messageCount: messages.length,
      toolCount: tools?.length || 0,
      requestId,
      headers: config.headers,
    })

    try {
      // 创建模型
      const model = createModel(config)

      // 转换消息
      let coreMessages = this.messageConverter.convert(messages, systemPrompt)

      // 应用 Prompt Caching
      const cachePreparation = await prepareRequestCache(config, coreMessages)
      coreMessages = cachePreparation.messages

      // 转换工具
      const coreTools = tools ? this.toolConverter.convert(tools) : undefined

      // 构建 streamText 参数
      const streamParams: Parameters<typeof streamText>[0] = {
        model,
        messages: coreMessages,
        tools: coreTools,
        activeTools,  // 动态限制可用工具

        // 核心参数
        maxOutputTokens: config.maxTokens,
        temperature: config.temperature,
        // topP 为 1 时等于默认行为（不过滤），无需传递
        // 且部分模型（如 Claude）不允许 temperature 和 topP 同时指定
        topP: config.topP !== undefined && config.topP < 1 ? config.topP : undefined,
        topK: config.topK,
        frequencyPenalty: config.frequencyPenalty,
        presencePenalty: config.presencePenalty,
        stopSequences: config.stopSequences,
        seed: config.seed,

        // AI SDK 高级参数
        maxRetries: config.maxRetries,
        toolChoice: config.toolChoice,
        headers: resolveHeaderPlaceholders(config.headers, config.apiKey),
        timeout: config.timeout,  // 超时配置
        abortSignal,
        providerOptions: cachePreparation.providerOptions,
      }

      // OpenAI 特定参数
      if (config.provider === 'openai') {
        if (config.logitBias) {
          // @ts-expect-error - OpenAI specific parameter
          streamParams.logitBias = config.logitBias
        }
        if (config.parallelToolCalls !== undefined) {
          streamParams.providerOptions = {
            ...streamParams.providerOptions,
            openai: {
              ...streamParams.providerOptions?.openai,
              parallelToolCalls: config.parallelToolCalls,
            },
          }
        }
      }

      // 启用 thinking 模式（各厂商配置不同）
      // 使用 spread 合并，避免覆盖已有的 providerOptions（如 parallelToolCalls）
      if (config.enableThinking) {
        const protocol = config.protocol || ''

        if (config.provider === 'gemini' || protocol === 'google') {
          // Google Gemini: 区分 Gemini 3 (thinkingLevel) 和 Gemini 2.5 (thinkingBudget)
          const isGemini3 = /gemini-3/i.test(config.model)
          streamParams.providerOptions = {
            ...streamParams.providerOptions,
            google: {
              ...(streamParams.providerOptions?.google as object),
              thinkingConfig: isGemini3
                ? { thinkingLevel: config.reasoningEffort || 'medium', includeThoughts: true }
                : { thinkingBudget: config.thinkingBudget || 10000, includeThoughts: true },
            },
          }
        } else if (config.provider === 'anthropic' || protocol === 'anthropic') {
          // Anthropic Claude: thinking 需要 type + budgetTokens（必须参数）
          streamParams.providerOptions = {
            ...streamParams.providerOptions,
            anthropic: {
              ...(streamParams.providerOptions?.anthropic as object),
              thinking: {
                type: 'enabled',
                budgetTokens: config.thinkingBudget || 10000,
              },
            },
          }
        } else {
          // OpenAI (chat/responses) 及其他兼容协议
          streamParams.providerOptions = {
            ...streamParams.providerOptions,
            openai: {
              ...(streamParams.providerOptions?.openai as object),
              reasoningEffort: config.reasoningEffort || 'medium',
              reasoningSummary: 'detailed',
            },
          }
        }
      }

      // 流式生成 - AI SDK 6.0 自动处理所有 reasoning
      const result = streamText({
        ...streamParams,
        // 自动修复工具调用 JSON 格式错误
        experimental_repairToolCall: async ({ toolCall, error }) => {
          logger.llm.warn('[StreamingService] Tool call parse error, attempting repair:', {
            toolName: toolCall.toolName,
            error: error.message,
          })

          try {
            const inputText = toolCall.input

            // 1. 修复未闭合的引号
            let fixed = inputText.replace(/([^\\])"([^"]*?)$/g, '$1"$2"')

            // 2. 修复未闭合的大括号
            const openBraces = (fixed.match(/\{/g) || []).length
            const closeBraces = (fixed.match(/\}/g) || []).length
            if (openBraces > closeBraces) {
              fixed += '}'.repeat(openBraces - closeBraces)
            }

            // 3. 修复未闭合的方括号
            const openBrackets = (fixed.match(/\[/g) || []).length
            const closeBrackets = (fixed.match(/\]/g) || []).length
            if (openBrackets > closeBrackets) {
              fixed += ']'.repeat(openBrackets - closeBrackets)
            }

            // 4. 尝试解析修复后的 JSON
            JSON.parse(fixed)

            logger.llm.info('[StreamingService] Tool call repaired successfully')
            return {
              ...toolCall,
              input: fixed,
            }
          } catch (repairError) {
            logger.llm.error('[StreamingService] Tool call repair failed:', repairError)
            return null // 返回 null 表示无法修复
          }
        },
      })

      // 处理流式响应
      return await this.processStream(
        result,
        strategy,
        requestId,
        resolveStreamIdleTimeoutMs(config)
      )
    } catch (error) {
      if (abortSignal?.aborted) {
        const abortedError = new LLMError(
          'Request was cancelled',
          ErrorCode.ABORTED,
          false,
        )
        this.sendEvent(requestId, { type: 'error', error: abortedError })
        throw abortedError
      }

      // LLMError.fromError 会自动使用 mapAISDKError 获取友好消息
      const unsupportedFeature = detectUnsupportedCacheFeature(error, config)
      if (unsupportedFeature && recoveryState.cacheRetryCount < 1) {
        markCacheFeatureUnsupported(
          config,
          unsupportedFeature,
          getCacheFeatureErrorReason(error)
        )
        return await this.generateWithRecovery(params, {
          ...recoveryState,
          cacheRetryCount: recoveryState.cacheRetryCount + 1,
        })
      }

      const llmError = LLMError.fromError(error)

      this.sendEvent(requestId, { type: 'error', error: llmError })
      throw llmError
    }
  }

  /**
   * 处理流式响应
   * AI SDK 6.0 自动处理 reasoning-delta，我们只需处理特殊格式（如 MiniMax XML 标签）
   */
  private async processStream(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result: StreamTextResult<any, any>,
    strategy: ThinkingStrategy,
    requestId: string,
    streamIdleTimeoutMs: number
  ): Promise<StreamingResult> {
    let reasoning = ''
    const hasCustomParser = !!strategy.parseStreamText
    let streamError: Error | null = null
    let sawToolActivity = false
    let sawExecutableToolCall = false
    const iterator = result.fullStream[Symbol.asyncIterator]()

    while (true) {
      const next = await this.nextStreamPart(iterator, requestId, streamIdleTimeoutMs)
      if (next.done) break
      const part = next.value
      if (this.window.isDestroyed()) break

      try {
        switch (part.type) {
          case 'text-delta':
            if (hasCustomParser && strategy.parseStreamText) {
              const parsed = strategy.parseStreamText(part.text)
              if (parsed.thinking) {
                reasoning += parsed.thinking
                this.sendEvent(requestId, { type: 'reasoning', content: parsed.thinking })
              }
              if (parsed.content) {
                this.sendEvent(requestId, { type: 'text', content: parsed.content })
              }
            } else {
              this.sendEvent(requestId, { type: 'text', content: part.text })
            }
            break

          case 'reasoning-delta':
            if (part.text) {
              reasoning += part.text
              this.sendEvent(requestId, { type: 'reasoning', content: part.text })
            }
            break

          case 'tool-input-start':
            sawToolActivity = true
            this.sendEvent(requestId, {
              type: 'tool-call-start',
              id: part.id,
              name: part.toolName,
            })
            break

          case 'tool-input-delta':
            sawToolActivity = true
            this.sendEvent(requestId, {
              type: 'tool-call-delta',
              id: part.id,
              argumentsDelta: part.delta,
            })
            break

          case 'tool-input-end':
            sawToolActivity = true
            this.sendEvent(requestId, {
              type: 'tool-call-delta-end',
              id: part.id,
            })
            break

          case 'tool-call':
            sawToolActivity = true
            sawExecutableToolCall = true
            this.sendEvent(requestId, {
              type: 'tool-call-available',
              id: part.toolCallId,
              name: part.toolName,
              arguments: part.input as Record<string, unknown>,
            })
            break

          case 'error':
            // 捕获流中的错误，稍后抛出
            if (!streamError) {
              streamError = part.error instanceof Error
                ? part.error
                : new Error(String(part.error ?? 'Unknown stream error'))
            }
            break
        }
      } catch (error) {
        if (!this.window.isDestroyed()) {
          logger.llm.warn('[StreamingService] Error processing stream part:', error)
        }
      }
    }

    // 如果流中有错误，优先抛出真实错误而不是 NoOutputGeneratedError
    if (streamError) {
      throw streamError
    }

    // 获取最终结果
    const text = await result.text
    const usage = await result.usage
    const response = await result.response

    // 使用策略提取最终 thinking
    let finalText = text
    let finalReasoning = reasoning
    if (strategy.extractThinking) {
      const parsed = strategy.extractThinking(text)
      finalText = parsed.content
      if (parsed.thinking) {
        finalReasoning = parsed.thinking
      }
    }

    const finishReason = await result.finishReason

    if (finishReason === 'tool-calls' && !sawExecutableToolCall) {
      throw new LLMError(
        'Model stopped with tool-calls finish reason but did not produce any executable tool call',
        ErrorCode.LLM_NO_OUTPUT,
        true,
      )
    }

    if (!finalText.trim() && !finalReasoning.trim() && !sawToolActivity) {
      throw new LLMError(
        'Model returned an empty response after the API call completed',
        ErrorCode.LLM_EMPTY_RESPONSE,
        true,
      )
    }

    logger.llm.info('[StreamingService] Stream completed', {
      requestId,
      contentLength: finalText.length,
      reasoningLength: finalReasoning.length,
      sawToolActivity,
      sawExecutableToolCall,
      finishReason,
    })

    const streamingResult: StreamingResult = {
      content: finalText,
      reasoning: finalReasoning || undefined,
      usage: usage ? convertUsage(usage) : undefined,
      metadata: {
        id: response.id,
        modelId: response.modelId,
        timestamp: response.timestamp,
        finishReason: finishReason || undefined,
      },
    }

    this.sendEvent(requestId, {
      type: 'done',
      usage: streamingResult.usage,
      metadata: streamingResult.metadata,
    })

    return streamingResult
  }

  /**
   * 发送事件到渲染进程（批量发送优化）
   */
  private sendEvent(requestId: string, event: StreamEvent): void {
    if (this.window.isDestroyed()) return

    // 立即发送的事件类型（不批量）
    const immediateEvents = ['error', 'done', 'tool-call-start', 'tool-call-available']

    if (immediateEvents.includes(event.type)) {
      this.flushEvents(requestId) // 先刷新缓冲区
      this.sendEventImmediate(requestId, event)
      return
    }

    // 批量发送的事件类型（text, reasoning, tool-call-delta）
    if (!this.eventBuffer.has(requestId)) {
      this.eventBuffer.set(requestId, [])
    }

    this.eventBuffer.get(requestId)!.push(event)

    // 清除旧的定时器
    const existingTimer = this.flushTimers.get(requestId)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    // 设置新的定时器（50ms 批量发送）
    const timer = setTimeout(() => {
      this.flushEvents(requestId)
    }, 50)

    this.flushTimers.set(requestId, timer)
  }

  /**
   * 刷新事件缓冲区
   */
  private flushEvents(requestId: string): void {
    const events = this.eventBuffer.get(requestId)
    if (!events || events.length === 0) return

    if (this.window.isDestroyed()) {
      this.eventBuffer.delete(requestId)
      this.flushTimers.delete(requestId)
      return
    }

    try {
      // 批量发送所有事件
      this.window.webContents.send(`llm:stream:${requestId}`, {
        type: 'batch',
        events: events.map(e => this.serializeEvent(e))
      })
    } catch (error) {
      logger.llm.error('[StreamingService] Failed to flush events:', error)
    }

    this.eventBuffer.delete(requestId)
    this.flushTimers.delete(requestId)
  }

  /**
   * 序列化事件
   */
  private serializeEvent(event: StreamEvent): any {
    switch (event.type) {
      case 'text':
        return { type: 'text', content: event.content }
      case 'reasoning':
        return { type: 'reasoning', content: event.content }
      case 'tool-call-delta':
        return {
          type: 'tool_call_delta',
          id: event.id,
          name: event.name,
          argumentsDelta: event.argumentsDelta,
        }
      case 'tool-call-delta-end':
        return { type: 'tool_call_delta_end', id: event.id }
      default:
        return event
    }
  }

  /**
   * 立即发送事件（不批量）
   */
  private sendEventImmediate(requestId: string, event: StreamEvent): void {
    if (this.window.isDestroyed()) return

    try {
      switch (event.type) {
        case 'tool-call-start':
          this.window.webContents.send(`llm:stream:${requestId}`, {
            type: 'tool_call_start',
            id: event.id,
            name: event.name,
          })
          break

        case 'tool-call-available':
          this.window.webContents.send(`llm:stream:${requestId}`, {
            type: 'tool_call_available',
            id: event.id,
            name: event.name,
            arguments: event.arguments,
          })
          break

        case 'error':
          this.window.webContents.send(`llm:error:${requestId}`, {
            message: event.error.message,
            code: event.error.code,
            retryable: event.error.retryable,
          })
          break

        case 'done':
          logger.llm.info('[StreamingService] Sending done event', { requestId, channel: `llm:done:${requestId}` })
          this.window.webContents.send(`llm:done:${requestId}`, {
            usage: event.usage ? {
              promptTokens: event.usage.inputTokens,
              completionTokens: event.usage.outputTokens,
              totalTokens: event.usage.totalTokens,
              cachedInputTokens: event.usage.cachedInputTokens,
              cacheWriteTokens: event.usage.cacheWriteTokens,
              reasoningTokens: event.usage.reasoningTokens,
            } : undefined,
            metadata: event.metadata,
          })
          break
      }
    } catch (error) {
      logger.llm.error('[StreamingService] Failed to send event:', error)
    }
  }

  private async nextStreamPart(
    iterator: AsyncIterator<any>,
    requestId: string,
    idleTimeoutMs: number
  ): Promise<IteratorResult<any>> {
    let timeoutId: NodeJS.Timeout | null = null

    try {
      return await Promise.race([
        iterator.next().finally(() => {
          if (timeoutId) {
            clearTimeout(timeoutId)
            timeoutId = null
          }
        }),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            logger.llm.warn('[StreamingService] Stream idle timeout waiting for next chunk', {
              requestId,
              idleTimeoutMs,
            })
            void iterator.return?.()
            reject(new LLMError(
              `Model stream stalled for more than ${Math.floor(idleTimeoutMs / 1000)}s`,
              ErrorCode.TIMEOUT,
              true,
            ))
          }, idleTimeoutMs)
        }),
      ])
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }
}
