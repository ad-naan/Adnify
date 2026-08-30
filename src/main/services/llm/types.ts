/**
 * LLM 服务类型定义
 */

import type { LanguageModelUsage, ProviderMetadata } from 'ai'
import { mapAISDKError, ErrorCode } from '@shared/utils/errorHandler'
import type { LLMStreamSource } from '@shared/types/llm'

// ============================================
// 基础类型
// ============================================

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  cacheReadSource?: 'provider-reported' | 'derived'
  cacheWriteSource?: 'provider-reported' | 'estimated'
}

export interface ResponseMetadata {
  id: string
  modelId: string
  timestamp: Date
  finishReason?: string
}

export type StreamSource = LLMStreamSource

export interface LLMResponse<T> {
  data: T
  usage?: TokenUsage
  metadata?: ResponseMetadata
}

// ============================================
// 错误类型
// ============================================

/**
 * LLM 错误类
 */
export class LLMError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly retryable: boolean = false,
    public readonly status?: number,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'LLMError'
    Error.captureStackTrace?.(this, LLMError)
  }

  /**
   * 从 AI SDK 错误创建 LLMError
   * 默认使用原报错，如果是特定应用级报错由前端组装
   */
  static fromAISDKError(error: Error, status?: number): LLMError {
    const mapped = mapAISDKError(error)
    return new LLMError(mapped.originalMessage, mapped.code, mapped.retryable, status, error)
  }

  /**
   * 从任意错误创建 LLMError
   */
  static fromError(error: unknown): LLMError {
    if (error instanceof LLMError) {
      return error
    }

    if (error instanceof Error) {
      return LLMError.fromAISDKError(error)
    }

    if (typeof error === 'string') {
      return new LLMError(error, ErrorCode.UNKNOWN, false)
    }

    return new LLMError('Unknown error', ErrorCode.UNKNOWN, false)
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      retryable: this.retryable,
      status: this.status,
    }
  }
}

// ============================================
// 流式事件类型
// ============================================

export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'tool-call-start'; id: string; name: string }
  | { type: 'tool-call-delta'; id: string; name?: string; argumentsDelta: string }
  | { type: 'tool-call-delta-end'; id: string }
  | { type: 'tool-call-available'; id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'source'; source: StreamSource }
  | { type: 'error'; error: LLMError }
  | { type: 'done'; usage?: TokenUsage; metadata?: ResponseMetadata; reasoning?: string; reasoningSignature?: string }

/**
 * 必须绕过合批、立即送达的事件。
 *
 * 为什么这个划分要上升到类型：这些事件的载荷是 sendEventImmediate 手写的，而合批
 * 通道的载荷是 serializeEvent 翻译的（kebab→snake）。以前这个划分是一个裸的
 * `string[]`，`includes` 不会窄化任何东西，于是把某个事件从立即通道挪进合批通道
 * 只需要动一个字符串——它就会命中 serializeEvent 的 `default: return event`，
 * 以 kebab-case 上线，被渲染端无 default 的 switch 静默丢弃。工具调用整个消失，
 * 而类型检查全绿。
 *
 * 现在两侧的形参类型都由这里派生：挪动一个事件会在 serializeEvent 少一个 case
 * 或 sendEventImmediate 多一个未处理分支上直接编译报错。
 */
export const IMMEDIATE_STREAM_EVENT_TYPES = [
  'error',
  'done',
  'tool-call-start',
  'tool-call-available',
] as const

export type ImmediateStreamEventType = typeof IMMEDIATE_STREAM_EVENT_TYPES[number]

/** 走 llm:error / llm:done / 裸 llm:stream 载荷的事件 */
export type ImmediateStreamEvent = Extract<StreamEvent, { type: ImmediateStreamEventType }>

/** 进合批缓冲、由 serializeEvent 翻成 snake_case 的事件 */
export type BufferedStreamEvent = Exclude<StreamEvent, ImmediateStreamEvent>

export function isImmediateStreamEvent(event: StreamEvent): event is ImmediateStreamEvent {
  return (IMMEDIATE_STREAM_EVENT_TYPES as readonly string[]).includes(event.type)
}

// ============================================
// 结构化输出类型
// ============================================

export interface CodeIssue {
  severity: 'error' | 'warning' | 'info' | 'hint'
  message: string
  line: number
  column: number
  endLine?: number
  endColumn?: number
  code?: string
  source?: string
}

export interface CodeSuggestion {
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
  changes?: Array<{
    line: number
    oldText: string
    newText: string
  }>
}

export interface CodeAnalysis {
  issues: CodeIssue[]
  suggestions: CodeSuggestion[]
  summary: string
}

export interface RefactoringChange {
  type: 'replace' | 'insert' | 'delete'
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  newText?: string
}

export interface Refactoring {
  refactorings: Array<{
    title: string
    description: string
    confidence: 'high' | 'medium' | 'low'
    changes: RefactoringChange[]
    explanation: string
  }>
}

export interface CodeFix {
  fixes: Array<{
    diagnosticIndex: number
    title: string
    description: string
    changes: Array<{
      startLine: number
      startColumn: number
      endLine: number
      endColumn: number
      newText: string
    }>
    confidence: 'high' | 'medium' | 'low'
  }>
}

export interface TestCase {
  testCases: Array<{
    name: string
    description: string
    code: string
    type: 'unit' | 'integration' | 'edge-case'
  }>
  setup?: string
  teardown?: string
}

// ============================================
// 工具函数
// ============================================

export function convertUsage(
  usage: LanguageModelUsage,
  providerMetadata?: ProviderMetadata,
  extra?: Partial<Pick<TokenUsage, 'cacheWriteTokens'>>
): TokenUsage {
  const usageAny = usage as any
  const rawUsage = usageAny.raw as Record<string, unknown> | undefined
  const metadata = providerMetadata as Record<string, unknown> | undefined
  const anthropicMetadata = getNestedValue(metadata, ['anthropic']) as Record<string, unknown> | undefined
  const anthropicUsage = anthropicMetadata?.usage as Record<string, unknown> | undefined
  const googleUsageMetadata = getNestedValue(metadata, ['google', 'usageMetadata'])
  const openaiMetadata = getNestedValue(metadata, ['openai']) as Record<string, unknown> | undefined
  const cachedInputTokens = readNumber(
    usageAny.inputTokenDetails?.cacheReadTokens,
    usageAny.inputTokens?.cacheRead,
    usageAny.cachedInputTokens,
    rawUsage?.cache_read_input_tokens,
    anthropicUsage?.cache_read_input_tokens,
    getNestedValue(rawUsage, ['prompt_tokens_details', 'cached_tokens']),
    getNestedValue(rawUsage, ['input_tokens_details', 'cached_tokens']),
    getNestedValue(googleUsageMetadata, ['cachedContentTokenCount']),
    rawUsage?.cachedContentTokenCount,
    openaiMetadata?.cachedPromptTokens,
  ) ?? 0
  const providerReportedCacheWriteTokens = readNumber(
    usageAny.inputTokenDetails?.cacheWriteTokens,
    usageAny.inputTokens?.cacheWrite,
    rawUsage?.cache_creation_input_tokens,
    anthropicUsage?.cache_creation_input_tokens,
    anthropicMetadata?.cacheCreationInputTokens,
  ) ?? 0
  const estimatedCacheWriteTokens = extra?.cacheWriteTokens ?? 0
  const cacheWriteTokens = providerReportedCacheWriteTokens + estimatedCacheWriteTokens
  const cacheReadSource = cachedInputTokens > 0 ? 'provider-reported' : undefined
  const cacheWriteSource = providerReportedCacheWriteTokens > 0
    ? 'provider-reported'
    : estimatedCacheWriteTokens > 0
      ? 'estimated'
      : undefined

  return {
    inputTokens: usage.inputTokens || 0,
    outputTokens: usage.outputTokens || 0,
    totalTokens: usage.totalTokens || ((usage.inputTokens || 0) + (usage.outputTokens || 0)),
    cachedInputTokens,
    cacheWriteTokens,
    reasoningTokens: usageAny.outputTokenDetails?.reasoningTokens ?? usageAny.reasoningTokens,
    cacheReadSource,
    cacheWriteSource,
  }
}

function readNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
  }

  return undefined
}

function getNestedValue(source: unknown, path: string[]): unknown {
  let current = source

  for (const key of path) {
    if (!current || typeof current !== 'object' || !(key in (current as Record<string, unknown>))) {
      return undefined
    }
    current = (current as Record<string, unknown>)[key]
  }

  return current
}
