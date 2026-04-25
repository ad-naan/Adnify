/**
 * 流式服务 - 使用 AI SDK 6.0 streamText
 * 工具调用只接受原生 tool-call 事件；特殊处理仅用于部分模型的 thinking 标签解析。
 */

import { streamText } from 'ai'
import type { StreamTextResult } from 'ai'
import { BrowserWindow } from 'electron'
import { logger } from '@shared/utils/Logger'
import { ErrorCode } from '@shared/utils/errorHandler'
import { createModel } from '../modelFactory'
import { MessageConverter } from '../core/MessageConverter'
import { ToolConverter } from '../core/ToolConverter'
import { prepareExecutionRequest } from '../core/RequestExecution'
import { executeWithGenerationRecovery } from '../core/GenerationRecovery'
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

const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 15_000

interface PseudoToolCallPayload {
  name: string
  arguments: Record<string, unknown>
}

type PseudoToolCaptureMode = 'json-array' | 'xml-tag'

function createCompatToolCallId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `compat-tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function looksLikePseudoToolPayloadStart(text: string): PseudoToolCaptureMode | null {
  const trimmed = text.trimStart()
  if (!trimmed) return null
  if (trimmed.startsWith('<tool_call>')) {
    return 'xml-tag'
  }

  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) {
    return null
  }

  const probe = trimmed.slice(0, 256)
  if (/"name"\s*:/.test(probe) && /"parameters"\s*:/.test(probe)) {
    return 'json-array'
  }

  return null
}

function tryParsePseudoToolPayload(text: string): PseudoToolCallPayload | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const payloadText = trimmed.startsWith('<tool_call>') && trimmed.endsWith('</tool_call>')
    ? trimmed.slice('<tool_call>'.length, trimmed.length - '</tool_call>'.length).trim()
    : trimmed

  try {
    const parsed = JSON.parse(payloadText) as unknown
    const candidate = Array.isArray(parsed) ? parsed[0] : parsed
    if (!candidate || typeof candidate !== 'object') {
      return null
    }

    const name = (candidate as Record<string, unknown>).name
    const parameters = (candidate as Record<string, unknown>).parameters
    if (typeof name !== 'string' || !parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
      return null
    }

    return {
      name,
      arguments: parameters as Record<string, unknown>,
    }
  } catch {
    return null
  }
}

function extractPseudoToolName(text: string): string | null {
  const match = text.match(/"name"\s*:\s*"([^"]+)"/)
  return match?.[1] ?? null
}

function findParametersObjectStart(text: string): number {
  const keyMatch = /"parameters"\s*:/.exec(text)
  if (!keyMatch) return -1
  return text.indexOf('{', keyMatch.index + keyMatch[0].length)
}

function findJsonObjectEnd(text: string, startIndex: number): number {
  if (startIndex < 0 || text[startIndex] !== '{') {
    return -1
  }

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{') {
      depth++
      continue
    }

    if (ch === '}') {
      depth--
      if (depth === 0) {
        return i
      }
    }
  }

  return -1
}

function normalizeToolCallArguments(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>
  }

  if (typeof input !== 'string' || !input.trim()) {
    return {}
  }

  try {
    const parsed = JSON.parse(input) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Ignore malformed provider payloads and fall back to an empty object.
  }

  return {}
}

class PseudoToolCallStreamAdapter {
  private mode: 'idle' | 'probing' | 'capturing' | 'disabled' = 'idle'
  private probeBuffer = ''
  private captureBuffer = ''
  private toolCallId: string | null = null
  private toolName: string | null = null
  private emittedArgumentChars = 0
  private started = false
  private completed = false

  constructor(private readonly enabled: boolean) {}

  consume(chunk: string): { visibleText: string; events: StreamEvent[] } {
    if (!this.enabled || !chunk) {
      return { visibleText: chunk, events: [] }
    }

    if (this.mode === 'disabled') {
      return { visibleText: chunk, events: [] }
    }

    if (this.mode === 'capturing') {
      return this.consumeCapturedChunk(chunk)
    }

    this.probeBuffer += chunk
    const trimmed = this.probeBuffer.trimStart()
    if (trimmed) {
      const firstChar = trimmed[0]
      if (firstChar !== '[' && firstChar !== '{' && firstChar !== '<') {
        const visibleText = this.probeBuffer
        this.probeBuffer = ''
        this.mode = 'disabled'
        return { visibleText, events: [] }
      }
    }

    const detectedMode = looksLikePseudoToolPayloadStart(this.probeBuffer)
    if (!detectedMode) {
      if (trimmed.startsWith('<') && !'<tool_call>'.startsWith(trimmed.slice(0, Math.min(trimmed.length, '<tool_call>'.length)))) {
        const visibleText = this.probeBuffer
        this.probeBuffer = ''
        this.mode = 'disabled'
        return { visibleText, events: [] }
      }

      if (trimmed && this.probeBuffer.length >= 256) {
        const visibleText = this.probeBuffer
        this.probeBuffer = ''
        this.mode = 'disabled'
        return { visibleText, events: [] }
      }
      return { visibleText: '', events: [] }
    }

    this.mode = 'capturing'
    this.captureBuffer = this.probeBuffer
    this.probeBuffer = ''
    return this.consumeCapturedChunk('')
  }

  hasCapturedToolCall(): boolean {
    return this.started
  }

  finalize(): { visibleText: string; events: StreamEvent[] } {
    if (this.mode === 'probing' || this.mode === 'idle') {
      const visibleText = this.probeBuffer
      this.probeBuffer = ''
      return { visibleText, events: [] }
    }

    return { visibleText: '', events: [] }
  }

  private consumeCapturedChunk(chunk: string): { visibleText: string; events: StreamEvent[] } {
    if (chunk) {
      this.captureBuffer += chunk
    }

    const events: StreamEvent[] = []
    const name = extractPseudoToolName(this.captureBuffer)

    if (!this.started && name) {
      this.toolCallId = createCompatToolCallId()
      this.toolName = name
      this.started = true
      events.push({
        type: 'tool-call-start',
        id: this.toolCallId,
        name,
      })
    }

    if (this.started && this.toolCallId) {
      const paramStart = findParametersObjectStart(this.captureBuffer)
      if (paramStart >= 0) {
        const paramEnd = findJsonObjectEnd(this.captureBuffer, paramStart)
        const availableEnd = paramEnd >= 0 ? paramEnd + 1 : this.captureBuffer.length
        if (availableEnd > paramStart + this.emittedArgumentChars) {
          const delta = this.captureBuffer.slice(paramStart + this.emittedArgumentChars, availableEnd)
          this.emittedArgumentChars += delta.length
          if (delta) {
            events.push({
              type: 'tool-call-delta',
              id: this.toolCallId,
              name: this.toolName ?? undefined,
              argumentsDelta: delta,
            })
          }
        }
      }
    }

    if (!this.completed) {
      const parsed = tryParsePseudoToolPayload(this.captureBuffer)
      if (parsed && this.toolCallId) {
        this.completed = true
        events.push({
          type: 'tool-call-delta-end',
          id: this.toolCallId,
        })
        events.push({
          type: 'tool-call-available',
          id: this.toolCallId,
          name: parsed.name,
          arguments: parsed.arguments,
        })
      }
    }

    return { visibleText: '', events }
  }
}

function resolveStreamIdleTimeoutMs(timeoutMs?: number): number {
  if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return timeoutMs
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
    const strategy = ThinkingStrategyFactory.create(config.model)
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
      // 创建模型
      const model = createModel(config)

      // 转换消息
      let coreMessages = this.messageConverter.convert(messages, systemPrompt)

      const preparedRequest = await prepareExecutionRequest({
        config,
        baseMessages: coreMessages,
        originalMessages: messages,
        useCache,
      })
      coreMessages = preparedRequest.messages

      // 转换工具
      const coreTools = tools ? this.toolConverter.convert(tools) : undefined

      // 构建 streamText 参数
      const streamParams: Parameters<typeof streamText>[0] = {
        model,
        messages: coreMessages,
        tools: coreTools,
        activeTools,  // 动态限制可用工具
        ...preparedRequest.settings,
        ...preparedRequest.callOptions,
        abortSignal,
        providerOptions: preparedRequest.providerOptions,
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
        resolveStreamIdleTimeoutMs(preparedRequest.callOptions.timeout),
        (tools?.length ?? 0) > 0
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
   * AI SDK 6.0 自动处理 reasoning-delta；额外解析仅用于部分模型的 thinking 标签。
   */
  private async processStream(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result: StreamTextResult<any, any>,
    strategy: ThinkingStrategy,
    requestId: string,
    streamIdleTimeoutMs: number,
    enablePseudoToolAdapter: boolean
  ): Promise<StreamingResult> {
    let reasoning = ''
    let streamedText = ''
    let streamedResponseMetadata: ResponseMetadata | undefined
    let sawNonTextOutput = false
    const hasCustomParser = !!strategy.parseStreamText
    let streamError: Error | null = null
    let sawToolActivity = false
    let sawExecutableToolCall = false
    const iterator = result.fullStream[Symbol.asyncIterator]()
    const pseudoToolAdapter = new PseudoToolCallStreamAdapter(enablePseudoToolAdapter)

    while (true) {
      const next = await this.nextStreamPart(iterator, requestId, streamIdleTimeoutMs)
      if (next.done) break
      const part = next.value
      if (this.window.isDestroyed()) break

      try {
        switch (part.type) {
          case 'text-start':
          case 'text-end':
          case 'reasoning-start':
          case 'reasoning-end':
          case 'start':
          case 'finish':
          case 'raw':
          case 'abort':
            break

          case 'start-step':
            if (part.warnings.length > 0) {
              logger.llm.warn('[StreamingService] Provider warnings', {
                requestId,
                warnings: part.warnings,
              })
            }
            break

          case 'text-delta':
            if (hasCustomParser && strategy.parseStreamText) {
              const parsed = strategy.parseStreamText(part.text)
              if (parsed.thinking) {
                reasoning += parsed.thinking
                this.sendEvent(requestId, { type: 'reasoning', content: parsed.thinking })
              }
              if (parsed.content) {
                const adapted = pseudoToolAdapter.consume(parsed.content)
                for (const event of adapted.events) {
                  if (event.type === 'tool-call-start' || event.type === 'tool-call-delta' || event.type === 'tool-call-delta-end') {
                    sawToolActivity = true
                  }
                  if (event.type === 'tool-call-available') {
                    sawToolActivity = true
                    sawExecutableToolCall = true
                  }
                  this.sendEvent(requestId, event)
                }
                if (adapted.visibleText) {
                  streamedText += adapted.visibleText
                  this.sendEvent(requestId, { type: 'text', content: adapted.visibleText })
                }
              }
            } else {
              const adapted = pseudoToolAdapter.consume(part.text)
              for (const event of adapted.events) {
                if (event.type === 'tool-call-start' || event.type === 'tool-call-delta' || event.type === 'tool-call-delta-end') {
                  sawToolActivity = true
                }
                if (event.type === 'tool-call-available') {
                  sawToolActivity = true
                  sawExecutableToolCall = true
                }
                this.sendEvent(requestId, event)
              }
              if (adapted.visibleText) {
                streamedText += adapted.visibleText
                this.sendEvent(requestId, { type: 'text', content: adapted.visibleText })
              }
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
              arguments: normalizeToolCallArguments(part.input),
            })
            break

          case 'tool-result':
          case 'tool-error':
          case 'tool-output-denied':
          case 'tool-approval-request':
          case 'file':
            sawNonTextOutput = true
            break

          case 'source':
            sawNonTextOutput = true
            this.sendEvent(requestId, {
              type: 'source',
              source: {
                id: part.id,
                sourceType: part.sourceType,
                ...(part.sourceType === 'url'
                  ? {
                      url: part.url,
                      title: part.title,
                    }
                  : {
                      mediaType: part.mediaType,
                      title: part.title,
                      filename: part.filename,
                    }),
              },
            })
            break

          case 'response-metadata':
            streamedResponseMetadata = {
              id: part.id,
              modelId: part.modelId,
              timestamp: part.timestamp,
            }
            break

          case 'finish-step':
            if (!streamedResponseMetadata) {
              streamedResponseMetadata = {
                id: part.response.id,
                modelId: part.response.modelId,
                timestamp: part.response.timestamp,
              }
            }
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

    if (pseudoToolAdapter.hasCapturedToolCall()) {
      finalText = streamedText
    }

    const finishReason = await result.finishReason

    if (finishReason === 'tool-calls' && !sawExecutableToolCall) {
      throw new LLMError(
        'Model stopped with tool-calls finish reason but did not produce any executable tool call',
        ErrorCode.LLM_NO_OUTPUT,
        true,
      )
    }

    if (!finalText.trim() && !finalReasoning.trim() && !sawToolActivity && !sawNonTextOutput) {
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
      sawNonTextOutput,
      finishReason,
    })

    const streamingResult: StreamingResult = {
      content: finalText,
      reasoning: finalReasoning || undefined,
      usage: usage ? convertUsage(usage) : undefined,
      metadata: {
        id: streamedResponseMetadata?.id ?? response.id,
        modelId: streamedResponseMetadata?.modelId ?? response.modelId,
        timestamp: streamedResponseMetadata?.timestamp ?? response.timestamp,
        finishReason: finishReason || undefined,
      },
    }

    this.sendEvent(requestId, {
      type: 'done',
      reasoning: streamingResult.reasoning,
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

    // 设置新的定时器（30ms 批量发送，更细粒度喂给 renderer 的插值动画）
    const timer = setTimeout(() => {
      this.flushEvents(requestId)
    }, 30)

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
      case 'source':
        return { type: 'source', source: event.source }
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
            reasoning: event.reasoning,
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
