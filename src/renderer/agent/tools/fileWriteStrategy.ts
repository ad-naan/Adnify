/**
 * 文件职责：
 * 1. 统一判断 write_file 这次调用的真实意图，是“新建”、“整文件重写”还是“局部修改”。
 * 2. 为执行层提供强约束，防止模型把已有文件的局部修改误用成整文件覆盖。
 * 3. 将“是否允许 write_file 执行”的规则收敛到一个地方，避免散落在提示词和执行器里。
 *
 * 设计原则：
 * - write_file 保持“整文件写入”语义，不承担局部编辑职责。
 * - edit_file 保持“局部修改”语义，不让 write_file 去抢这部分工作。
 * - 策略层只做判定，不直接执行 IO，便于复用、测试和后续扩展。
 */
export type WriteIntent = 'create' | 'full-rewrite' | 'partial-update'

/**
 * 一次写入分析的结构化结果。
 * 这些字段既用于判定是否允许 write_file，也可用于调试、日志和元信息回传。
 */
export interface WriteIntentAnalysis {
  intent: WriteIntent
  commonPrefixChars: number
  commonSuffixChars: number
  changedOriginalChars: number
  changedNewChars: number
  changedRatio: number
}

export interface WriteGuardInput {
  path: string
  originalContent: string
  nextContent: string
  hasRecentRead: boolean
}

export interface WriteGuardDecision {
  allow: boolean
  intent: WriteIntent
  reason?: string
  analysis: WriteIntentAnalysis
}

// 当“原文件被改动的比例”低于该阈值时，倾向判定为局部修改而不是整文件重写。
const PARTIAL_CHANGE_RATIO_THRESHOLD = 0.35
// 即使比例看起来不大，只要实际改动字符数非常小，也优先视为局部修改。
const SMALL_PARTIAL_CHANGE_CHARS = 1200
// 大文件场景下需要更保守，避免因为一次中小规模改动而走整文件覆盖。
const LARGE_FILE_THRESHOLD = 4000

/**
 * 计算两个字符串从头开始的最长公共前缀。
 * 这个值越大，说明文件前半部分越稳定，改动更可能集中在局部区域。
 */
function getCommonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length)
  let i = 0
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) {
    i++
  }
  return i
}

/**
 * 计算两个字符串从尾部开始的最长公共后缀。
 * 结合公共前缀后，可以近似估算“中间真正发生变化的区域”。
 */
function getCommonSuffixLength(a: string, b: string, prefixLength: number): number {
  const max = Math.min(a.length, b.length) - prefixLength
  let i = 0
  while (
    i < max &&
    a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)
  ) {
    i++
  }
  return i
}

/**
 * 分析一次 write_file 的真实意图。
 *
 * 这里不依赖 AST，也不做复杂 diff，而是用“公共前后缀 + 变化区间大小”做快速启发式判断。
 * 这么做的目标不是得到最完美的文本 diff，而是给工具选择提供稳定、低成本的决策依据。
 */
export function analyzeWriteIntent(originalContent: string, nextContent: string): WriteIntentAnalysis {
  if (originalContent.length === 0) {
    return {
      intent: 'create',
      commonPrefixChars: 0,
      commonSuffixChars: 0,
      changedOriginalChars: 0,
      changedNewChars: nextContent.length,
      changedRatio: 1,
    }
  }

  const commonPrefixChars = getCommonPrefixLength(originalContent, nextContent)
  const commonSuffixChars = getCommonSuffixLength(originalContent, nextContent, commonPrefixChars)
  const changedOriginalChars = Math.max(0, originalContent.length - commonPrefixChars - commonSuffixChars)
  const changedNewChars = Math.max(0, nextContent.length - commonPrefixChars - commonSuffixChars)
  const changedRatio = originalContent.length === 0 ? 1 : changedOriginalChars / originalContent.length

  const intent: WriteIntent =
    changedRatio <= PARTIAL_CHANGE_RATIO_THRESHOLD
      ? 'partial-update'
      : 'full-rewrite'

  return {
    intent,
    commonPrefixChars,
    commonSuffixChars,
    changedOriginalChars,
    changedNewChars,
    changedRatio,
  }
}

/**
 * write_file 执行前的统一守卫。
 *
 * 核心规则：
 * 1. 新文件允许直接 write_file。
 * 2. 已有文件如果没有先 read_file 建立上下文，不允许直接整写。
 * 3. 已有文件如果看起来只是局部修改，拒绝 write_file，强制引导走 edit_file。
 *
 * 这层守卫的价值在于：
 * - 把“提示词建议”升级为“执行层硬约束”；
 * - 降低大文件误整写导致的超时、冲突和无意义重试。
 */
export function guardWriteFile(input: WriteGuardInput): WriteGuardDecision {
  const analysis = analyzeWriteIntent(input.originalContent, input.nextContent)

  if (analysis.intent === 'create') {
    return {
      allow: true,
      intent: analysis.intent,
      analysis,
    }
  }

  if (!input.hasRecentRead) {
    return {
      allow: false,
      intent: analysis.intent,
      reason: `Refusing write_file for existing file ${input.path}: read_file must be used first so the agent can choose between edit_file and write_file with current content.`,
      analysis,
    }
  }

  const looksLikePartialUpdate =
    analysis.intent === 'partial-update' ||
    analysis.changedOriginalChars <= SMALL_PARTIAL_CHANGE_CHARS ||
    (input.originalContent.length >= LARGE_FILE_THRESHOLD && analysis.changedRatio <= 0.5)

  if (looksLikePartialUpdate) {
    return {
      allow: false,
      intent: 'partial-update',
      reason:
        `Refusing write_file for existing file ${input.path}: the change appears partial ` +
        `(${Math.round(analysis.changedRatio * 100)}% of original content changed, ` +
        `${analysis.changedOriginalChars} original chars affected). ` +
        'Use edit_file instead: string mode for a small unique local change, line mode for known line ranges, or batch mode for multiple edits.',
      analysis,
    }
  }

  return {
    allow: true,
    intent: analysis.intent,
    analysis,
  }
}
