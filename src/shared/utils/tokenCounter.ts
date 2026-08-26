/**
 * Token 计数工具
 * 
 * 统一的 token 计数接口，支持：
 * - 文本 token 计数
 * - 消息 token 计数（包含结构开销）
 * - 图片 token 计数
 * - 工具调用 token 计数
 */

import type { Tiktoken } from 'js-tiktoken/lite'

// ===== 类型定义 =====

export interface TokenCountOptions {
  model?: string
}

export interface MessageTokenCountOptions extends TokenCountOptions {
  includeSystemPrompt?: boolean
}

// ===== 编码器缓存 =====

let cachedEncoder: Tiktoken | null = null
let encoderLoadPromise: Promise<void> | null = null

/**
 * Load the large tokenizer table on demand instead of putting roughly 5 MB of
 * vocabulary data in the chat UI's initial chunk. AgentExecutor awaits this at
 * the request boundary, so all request budgeting remains exact. Lightweight
 * callers can still use the synchronous API before it is ready and receive the
 * conservative fallback estimate.
 */
export function ensureTokenEncoder(): Promise<void> {
  if (cachedEncoder) return Promise.resolve()
  if (encoderLoadPromise) return encoderLoadPromise

  encoderLoadPromise = Promise.all([
    import('js-tiktoken/lite'),
    import('js-tiktoken/ranks/cl100k_base'),
  ])
    .then(([{ Tiktoken }, { default: cl100kBase }]) => {
      // cl100k_base is OpenAI's tokenizer, and the only one bundled. For other
      // providers it is a baseline corrected by measured provider feedback.
      cachedEncoder = new Tiktoken(cl100kBase)
    })
    .catch((error: unknown) => {
      encoderLoadPromise = null
      console.warn('[TokenCounter] Tokenizer load failed, using fallback:', error)
    })

  return encoderLoadPromise
}

/**
 * Self-calibrating correction on top of the cl100k_base count.
 *
 * Only OpenAI models use cl100k_base. Every other provider tokenizes differently,
 * so a raw cl100k count is wrong by an unknown factor — and the model list cannot
 * be enumerated: this app supports custom providers, custom base URLs, local
 * Ollama models and aggregator gateways that rewrite model names.
 *
 * So instead of guessing per model name, we MEASURE. After each response the
 * provider reports real prompt tokens (loop.ts). Dividing that by what we
 * estimated for the same request yields this model's actual correction factor,
 * which is cached and applied to subsequent estimates. Unknown models start at
 * 1.0 and converge after a single turn.
 *
 * Note this only affects the pre-send estimate and the no-usage fallback path;
 * compression's main path already uses the provider's real usage numbers.
 */
const observedRatios = new Map<string, number>()

/** Clamped so one anomalous sample cannot wildly distort future estimates. */
const MIN_RATIO = 0.5
const MAX_RATIO = 3
/** Weight of each new observation; low enough to smooth out per-turn noise. */
const RATIO_SMOOTHING = 0.35

export function getModelTokenRatio(model?: string | null): number {
  if (!model) return 1
  return observedRatios.get(model) ?? 1
}

/**
 * Feed back a real prompt-token count so future estimates for this model improve.
 *
 * @param model - model id the request was sent to
 * @param estimatedTokens - what `countTokens`-based estimation predicted
 * @param actualTokens - prompt tokens the provider actually reported
 */
export function recordObservedTokenUsage(
  model: string | null | undefined,
  estimatedTokens: number,
  actualTokens: number
): void {
  if (!model || estimatedTokens <= 0 || actualTokens <= 0) return

  // `estimatedTokens` already includes the previous correction, so recover the
  // uncorrected baseline before deriving the new ratio.
  const previous = getModelTokenRatio(model)
  const baseline = estimatedTokens / previous
  if (baseline <= 0) return

  const sample = Math.min(MAX_RATIO, Math.max(MIN_RATIO, actualTokens / baseline))
  const blended = previous + (sample - previous) * RATIO_SMOOTHING
  observedRatios.set(model, Math.min(MAX_RATIO, Math.max(MIN_RATIO, blended)))
}

export function resetObservedTokenUsage(model?: string): void {
  if (model) observedRatios.delete(model)
  else observedRatios.clear()
}

/**
 * Model used to correct counts when a call site does not pass one explicitly.
 *
 * Token counting happens across many layers (context assembly, message assembly,
 * compression estimates) that would each need the model threaded through their
 * signatures. Setting it once per turn keeps those call sites unchanged while
 * still correcting the estimate. `null` means "raw cl100k count", which is the
 * historical behaviour and what tests expect by default.
 */
let activeModel: string | null = null

export function setActiveTokenModel(model: string | null | undefined): void {
  activeModel = model || null
}

export function getActiveTokenModel(): string | null {
  return activeModel
}

/**
 * 释放编码器资源（可选，通常不需要手动调用）
 */
export function freeEncoder(): void {
  cachedEncoder = null
  encoderLoadPromise = null
}

// ===== 核心函数 =====

/**
 * 计算文本的 token 数量
 *
 * @param text - 要计算的文本
 * @param model - Optional model id. Applies that model's measured correction
 *   factor (see `recordObservedTokenUsage`). Pass `null` for the raw count.
 * @returns token 数量
 */
export function countTokens(text: string, model?: string | null): number {
  if (!text) return 0

  const raw = countRawTokens(text)
  const effectiveModel = model !== undefined ? model : activeModel
  const ratio = getModelTokenRatio(effectiveModel)
  return ratio === 1 ? raw : Math.ceil(raw * ratio)
}

/** Raw cl100k_base count with no model correction. */
function countRawTokens(text: string): number {
  if (!text) return 0

  if (!cachedEncoder) return estimateTokensFallback(text)

  try {
    return cachedEncoder.encode(text).length
  } catch (error) {
    console.warn('[TokenCounter] Encoding failed, using fallback:', error)
    return estimateTokensFallback(text)
  }
}

/**
 * 计算消息内容的 token 数量
 * 
 * 支持：
 * - 纯文本字符串
 * - 结构化内容（文本 + 图片）
 * 
 * @param content - 消息内容
 * @returns token 数量
 */
export function countContentTokens(
  content: string | Array<{ type: string; text?: string; source?: unknown }>
): number {
  if (typeof content === 'string') {
    return countTokens(content)
  }
  
  let total = 0
  for (const part of content) {
    switch (part.type) {
      case 'text':
        if (part.text) {
          total += countTokens(part.text)
        }
        break
      
      case 'image':
        // Anthropic 图片 token 计算：
        // 实际公式：(width × height) / 750
        // 范围：258 - 1600 tokens
        // 由于无法获取实际尺寸，使用保守估计
        total += 1600
        break
      
      case 'tool_use':
      case 'tool_result':
        total += countTokens(JSON.stringify(part))
        break
      
      default:
        total += countTokens(JSON.stringify(part))
    }
  }
  
  return total
}

/**
 * 计算消息列表的 token 数量（包含结构开销）
 * 
 * 参考 OpenAI 官方文档：
 * - 每条消息固定开销：~4 tokens
 * - 每个字段（role, content, name）：~1 token
 * - 对话开始/结束：~3 tokens
 * 
 * @param messages - 消息列表
 * @returns token 数量
 */
export function countMessagesTokens(
  messages: Array<{
    role: string
    content?: string | Array<{ type: string; text?: string; source?: unknown }>
    name?: string
    tool_calls?: Array<{ id: string; name: string; arguments: unknown }>
    tool_call_id?: string
  }>
): number {
  let total = 3 // 对话开始/结束的固定开销
  
  for (const msg of messages) {
    total += 4 // 每条消息的固定开销
    
    // role
    total += countTokens(msg.role)
    
    // content
    if (msg.content) {
      total += countContentTokens(msg.content)
    }
    
    // name
    if (msg.name) {
      total += countTokens(msg.name)
    }
    
    // tool_calls
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += countTokens(tc.name)
        total += countTokens(JSON.stringify(tc.arguments))
        total += 3 // 工具调用结构开销
      }
    }
    
    // tool_call_id
    if (msg.tool_call_id) {
      total += countTokens(msg.tool_call_id)
    }
  }
  
  return total
}

// ===== 降级方案 =====

/**
 * 简单估算（降级方案）
 * 
 * 当 tiktoken 失败时使用
 */
function estimateTokensFallback(text: string): number {
  if (!text) return 0
  
  // 统计中文字符
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const totalChars = text.length
  const nonChineseChars = totalChars - chineseChars
  
  // 中文按 1.5 字符/token，其他按 4 字符/token
  return Math.ceil(chineseChars / 1.5 + nonChineseChars / 4)
}
