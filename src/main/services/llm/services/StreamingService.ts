/**
 * 流式服务 - 使用 AI SDK 7 streamText
 * 工具调用只接受原生 tool-call 事件；特殊处理仅用于部分模型的 thinking 标签解析。
 */

import { streamText } from 'ai'
import type { StreamTextResult } from 'ai'
import { BrowserWindow } from 'electron'
import { logger } from '@shared/utils/Logger'
import { ErrorCode } from '@shared/utils/errorHandler'
import { createModel, resolveAuthForConfig } from '../modelFactory'
import { MessageConverter } from '../core/MessageConverter'
import { ToolConverter } from '../core/ToolConverter'
import { prepareExecutionRequest } from '../core/RequestExecution'
import { executeWithGenerationRecovery } from '../core/GenerationRecovery'
import { LLMError, convertUsage } from '../types'
import type { TokenUsage, ResponseMetadata, StreamEvent } from '../types'
import { StreamTransport } from './streaming/streamTransport'
import { PseudoToolCallStreamAdapter } from './streaming/pseudoToolCallAdapter'
import { routeStreamPart, type StreamShapeFlags } from './streaming/streamPartRouter'
import type { LLMConfig, LLMMessage, ToolDefinition } from '@shared/types'
import type { ModelMessage } from '@ai-sdk/provider-utils'
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
  reasoningSignature?: string
  usage?: TokenUsage
  metadata?: ResponseMetadata
}

const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 15_000


function resolveStreamIdleTimeoutMs(timeoutMs?: number): number {
  if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return timeoutMs
  }

  return DEFAULT_STREAM_IDLE_TIMEOUT_MS
}

function stripSystemMessages(messages: ModelMessage[]): ModelMessage[] {
  return messages.filter(message => message.role !== 'system')
}

/**
 * 伪工具调用兼容适配器的开关。
 *
 * 历史行为是隐式的「这次请求带了工具就跑」——包括那些原生 tool-call 完全正常的
 * provider，它们白白付一次探测（首块正文被暂存到探测出形状为止）。现在把它写成
 * 显式能力位：默认仍是历史行为，路由可以用 `pseudoToolCallFallback: false` 关掉。
 * 没有工具时永远不跑，因为那时候不可能有工具调用要还原。
 */
function resolvePseudoToolAdapterEnabled(config: LLMConfig, tools?: ToolDefinition[]): boolean {
  if ((tools?.length ?? 0) === 0) return false
  return config.capabilities?.pseudoToolCallFallback ?? true
}

export class StreamingService {
  private messageConverter: MessageConverter
  private toolConverter: ToolConverter
  /** 线协议 + 合批节流都在这里，本类只管编排 */
  private readonly transport: StreamTransport

  constructor(window: BrowserWindow) {
    this.transport = new StreamTransport(window)
    this.messageConverter = new MessageConverter()
    this.toolConverter = new ToolConverter()
  }

  /**
   * 流式生成文本
   */
  async generate(params: StreamingParams): Promise<StreamingResult> {
    const { config, requestId, abortSignal } = params
    try {
      return await executeWithGenerationRecovery({
        config,
        operation: 'stream-text',
        requestId,
        abortSignal,
        execute: async (useCache) => {
          return this.generateOnce(params, useCache)
        },
      })
    } catch (error) {
      const llmError = error instanceof LLMError ? error : LLMError.fromError(error)
      this.sendEvent(requestId, { type: 'error', error: llmError })
      throw llmError
    }
  }

  private async generateOnce(params: StreamingParams, useCache: boolean): Promise<StreamingResult> {
    const { config, messages, tools, systemPrompt, abortSignal, activeTools, requestId } = params

    // 创建 thinking 策略（只为需要特殊处理的模型）
    const strategy = ThinkingStrategyFactory.create(config.capabilities?.thinkingTagFormat ?? 'native')
    strategy.reset?.()

    logger.system.info('[StreamingService] Starting generation', {
      provider: config.provider,
      model: config.model,
      messageCount: messages.length,
      toolCount: tools?.length || 0,
      requestId,
      protocol: config.protocol,
      hasCustomHeaders: Boolean(config.headers && Object.keys(config.headers).length > 0),
    })

    try {
      // 创建模型（OAuth provider 需先解析 access token）
      const resolvedConfig = await resolveAuthForConfig(config)
      const model = createModel(resolvedConfig)

      // 转换消息
      let coreMessages = this.messageConverter.convert(messages, systemPrompt, resolvedConfig)

      const preparedRequest = await prepareExecutionRequest({
        config: resolvedConfig,
        baseMessages: coreMessages,
        originalMessages: messages,
        systemPrompt,
        useCache,
      })
      coreMessages = preparedRequest.messages

      // 转换工具
      const coreTools = tools ? this.toolConverter.convert(tools) : undefined

      // 构建 streamText 参数
      const streamParams: Parameters<typeof streamText>[0] = {
        model,
        instructions: systemPrompt,
        messages: stripSystemMessages(coreMessages),
        tools: coreTools,
        activeTools,  // 动态限制可用工具
        ...preparedRequest.settings,
        ...preparedRequest.callOptions,
        abortSignal,
        providerOptions: preparedRequest.providerOptions,
      }

      // 流式生成 - AI SDK 7 自动处理所有 reasoning
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
        resolveStreamIdleTimeoutMs(preparedRequest.callOptions.timeout),
        resolvePseudoToolAdapterEnabled(resolvedConfig, tools),
        preparedRequest.cacheWriteTokens,
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
      throw LLMError.fromError(error)
    }
  }

  /**
   * 处理流式响应
   * AI SDK 7 自动处理 reasoning-delta；额外解析仅用于部分模型的 thinking 标签。
   */
  private async processStream(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result: StreamTextResult<any, any, any>,
    strategy: ThinkingStrategy,
    requestId: string,
    streamIdleTimeoutMs: number,
    enablePseudoToolAdapter: boolean,
    cacheWriteTokens?: number,
  ): Promise<StreamingResult> {
    let reasoning = ''
    let reasoningSignature = ''
    let streamedText = ''
    let streamedResponseMetadata: ResponseMetadata | undefined
    let fallbackResponseMetadata: ResponseMetadata | undefined
    let streamError: Error | null = null
    const shape: StreamShapeFlags = {
      sawToolActivity: false,
      sawExecutableToolCall: false,
      sawNonTextOutput: false,
    }
    const iterator = result.stream[Symbol.asyncIterator]()
    const pseudoToolAdapter = new PseudoToolCallStreamAdapter(enablePseudoToolAdapter)

    while (true) {
      const next = await this.nextStreamPart(iterator, requestId, streamIdleTimeoutMs)
      if (next.done) break
      if (this.transport.isWindowDestroyed()) break

      try {
        const outcome = routeStreamPart(next.value, {
          strategy,
          adapter: pseudoToolAdapter,
          requestId,
        })

        for (const event of outcome.events) {
          this.sendEvent(requestId, event)
        }

        streamedText += outcome.textAppend
        reasoning += outcome.reasoningAppend
        reasoningSignature += outcome.reasoningSignatureAppend
        if (outcome.responseMetadata) streamedResponseMetadata = outcome.responseMetadata
        if (outcome.responseMetadataFallback) fallbackResponseMetadata ??= outcome.responseMetadataFallback
        if (outcome.error && !streamError) streamError = outcome.error
        if (outcome.shape.sawToolActivity) shape.sawToolActivity = true
        if (outcome.shape.sawExecutableToolCall) shape.sawExecutableToolCall = true
        if (outcome.shape.sawNonTextOutput) shape.sawNonTextOutput = true
      } catch (error) {
        if (!this.transport.isWindowDestroyed()) {
          logger.llm.warn('[StreamingService] Error processing stream part:', error)
        }
      }
    }

    const finalAdapterState = pseudoToolAdapter.finalize()
    if (finalAdapterState.visibleText) {
      streamedText += finalAdapterState.visibleText
      this.sendEvent(requestId, { type: 'text', content: finalAdapterState.visibleText })
    }

    // 如果流中有错误，优先抛出真实错误而不是 NoOutputGeneratedError
    if (streamError) {
      throw streamError
    }

    // 获取最终结果
    const text = await result.text
    const usage = await result.usage
    const finalStep = await result.finalStep
    const providerMetadata = finalStep.providerMetadata
    const response = finalStep.response

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

    if (pseudoToolAdapter.hasCapturedToolCall()) {
      finalText = streamedText
    }

    const finishReason = await result.finishReason

    if (finishReason === 'tool-calls' && !shape.sawExecutableToolCall) {
      throw new LLMError(
        'Model stopped with tool-calls finish reason but did not produce any executable tool call',
        ErrorCode.LLM_NO_OUTPUT,
        true,
      )
    }

    if (!finalText.trim() && !finalReasoning.trim() && !shape.sawToolActivity && !shape.sawNonTextOutput) {
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
      ...shape,
      finishReason,
    })

    const resolvedMetadata = streamedResponseMetadata ?? fallbackResponseMetadata

    const streamingResult: StreamingResult = {
      content: finalText,
      reasoning: finalReasoning || undefined,
      reasoningSignature: reasoningSignature || undefined,
      usage: usage ? convertUsage(usage, providerMetadata, { cacheWriteTokens }) : undefined,
      metadata: {
        id: resolvedMetadata?.id ?? response.id,
        modelId: resolvedMetadata?.modelId ?? response.modelId,
        timestamp: resolvedMetadata?.timestamp ?? response.timestamp,
        finishReason: finishReason || undefined,
      },
    }

    this.sendEvent(requestId, {
      type: 'done',
      reasoning: streamingResult.reasoning,
      reasoningSignature: streamingResult.reasoningSignature,
      usage: streamingResult.usage,
      metadata: streamingResult.metadata,
    })

    return streamingResult
  }

  /** 发往渲染端的唯一出口：线协议与合批时序都在 StreamTransport 里 */
  private sendEvent(requestId: string, event: StreamEvent): void {
    this.transport.send(requestId, event)
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
