/**
 * 工具输出边界
 *
 * 工具结果是唯一会把任意大小的外部数据灌进模型上下文的通道，因此必须有一个
 * 明确的收敛点。这个模块是那个唯一的收敛点，它只回答两个问题：
 *
 *   1. 预算是多少 —— 由用户的 maxToolResultChars 单一决定（clampOutputBudget）。
 *   2. 超预算时怎么收敛 —— 取决于输出形态：
 *      - text: 保留信号所在的一端，中间插入省略说明（boundTextOutput）。
 *      - json: 走降级阶梯，逐级换更省的载荷，每一级都仍是合法 JSON（boundJsonOutput）。
 *
 * 为什么 json 不能走 text 那条路：结构化结果被「留头 + 留尾」切开之后不再可解析，
 * 模型拿到的是一段语法残骸，UI 侧的 JSON.parse 也会静默失败退成空列表。对结构化
 * 数据来说，正确的省法是丢弃字段和层级（body → 位置 → 计数），而不是丢弃字符。
 */

/** 工具结果的形态。决定超预算时用哪种收敛策略。 */
export type ToolOutputFormat = 'text' | 'json'

/**
 * 文本结果的信号所在端。超预算时优先保留这一端。
 *
 * - head: 绝大多数工具。文件内容、搜索命中、目录列表的价值都集中在前面。
 * - tail: 命令输出。报错、栈、退出码都在最后。
 */
export type ToolOutputSignal = 'head' | 'tail'

/** 预算下限。用户把 maxToolResultChars 调到极小时，仍要留出足以表达「被截断了」的空间。 */
const MIN_OUTPUT_BUDGET = 1000

/**
 * 头尾保留比例。两端之和小于 1，余量留给省略说明本身。
 *
 * 这里只有两组常量，而不是按工具名查表：一张按名字索引的比例表会随着工具增删而
 * 长出查不到的死键，而「信号在哪一端」本就是工具的固有属性，应该由工具自己声明。
 */
const SIGNAL_RATIOS: Record<ToolOutputSignal, { head: number; tail: number }> = {
  head: { head: 0.85, tail: 0.1 },
  tail: { head: 0.2, tail: 0.75 },
}

/** 把用户配置收敛成一个可用的正数预算。 */
export function clampOutputBudget(configured: number | undefined): number {
  if (!Number.isFinite(configured) || (configured as number) <= 0) return MIN_OUTPUT_BUDGET
  return Math.max(MIN_OUTPUT_BUDGET, Math.floor(configured as number))
}

// ============================================
// 代理对安全的切片
// ============================================

/**
 * JS 字符串按 UTF-16 code unit 索引，非 BMP 字符（emoji、CJK 扩展区如 U+20000）
 * 占两个 unit。裸 slice 切在两个 unit 中间会留下一个孤立代理，渲染成 U+FFFD 并
 * 原样进到发给模型的 tool 消息里 —— 表现就是「工具结果里出现一坨乱码」。
 *
 * 下面这组函数只做一件事：把边界从代理对中间挪开一格。宁可少一个字符，
 * 也不要吐出半个字符。
 */
function splitsSurrogatePair(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return false
  const prev = text.charCodeAt(index - 1)
  const curr = text.charCodeAt(index)
  return prev >= 0xd800 && prev <= 0xdbff && curr >= 0xdc00 && curr <= 0xdfff
}

/** 取前 end 个 code unit；若 end 落在代理对中间则往前退一格。 */
function sliceHead(text: string, end: number): string {
  if (end >= text.length) return text
  const safeEnd = splitsSurrogatePair(text, end) ? end - 1 : end
  return text.slice(0, Math.max(0, safeEnd))
}

/** 从 start 取到末尾；若 start 落在代理对中间则往后进一格。 */
function sliceTailFrom(text: string, start: number): string {
  if (start <= 0) return text
  const safeStart = splitsSurrogatePair(text, start) ? start + 1 : start
  return text.slice(Math.min(safeStart, text.length))
}

/** 在行尾截断（向前找换行符），找不到就退回代理对安全的硬切。 */
function truncateAtLineEnd(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text

  const searchStart = Math.max(0, maxLen - 100)
  const lastNewline = text.lastIndexOf('\n', maxLen)
  if (lastNewline > searchStart) return text.slice(0, lastNewline)

  return sliceHead(text, maxLen)
}

/** 在行首截断（向后找换行符）。换行符本身不可能是代理对的一半，该边界天然安全。 */
function truncateAtLineStart(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text

  const startPos = text.length - maxLen
  const searchEnd = Math.min(text.length, startPos + 100)
  const firstNewline = text.indexOf('\n', startPos)
  if (firstNewline !== -1 && firstNewline < searchEnd) return text.slice(firstNewline + 1)

  return sliceTailFrom(text, startPos)
}

// ============================================
// 文本收敛
// ============================================

/**
 * 把文本结果收敛到预算内，保留 signal 指定的一端。
 *
 * 注意这里不做任何内容嗅探。之前的实现会正则匹配 /error|exception|failed/ 并据此
 * 翻转头尾比例，结果是「一个恰好提到 error 的源文件」会被从开头砍掉 —— 用内容猜
 * 意图不如让工具直接声明。
 */
export function boundTextOutput(
  text: string,
  budget: number,
  signal: ToolOutputSignal = 'head',
): string {
  if (!text) return ''
  const limit = clampOutputBudget(budget)
  if (text.length <= limit) return text

  const ratios = SIGNAL_RATIOS[signal]
  const headSize = Math.floor(limit * ratios.head)
  const tailSize = Math.floor(limit * ratios.tail)
  const omitted = text.length - headSize - tailSize

  const head = truncateAtLineEnd(sliceHead(text, headSize + 200), headSize)
  const tail = truncateAtLineStart(sliceTailFrom(text, text.length - tailSize - 200), tailSize)

  return `${head}\n\n... [truncated: ${omitted.toLocaleString()} chars omitted] ...\n\n${tail}`
}

// ============================================
// 文件摘录收敛
// ============================================

/**
 * 把文件摘录收敛到预算内，超出时只保留开头并附上调用方给的后续指引。
 *
 * 与 boundTextOutput 的区别在于这里不留尾部：文件的行号是连续的，「前 200 行 +
 * 后 50 行」会让模型误以为中间的行号可以直接用于编辑。只给开头、并明确告诉它
 * 用行范围取剩下的部分，才是可行动的。
 *
 * footer 的长度从预算里预留，所以指引本身不会因为超预算而被后续边界层切掉 ——
 * 那正是它最需要出现的时候。
 */
export function boundFileExcerpt(
  content: string,
  budget: number,
  buildFooter: (retainedChars: number) => string,
): string {
  const limit = clampOutputBudget(budget)
  if (content.length <= limit) return content

  // 先用满额预算估一次 footer 长度，再据此定正文长度。footer 里通常带数字，
  // 长度会随保留量微幅变化，但预留是上界估计，不会反过来把正文挤爆。
  const footerAllowance = buildFooter(limit).length + 2
  const retained = Math.max(0, limit - footerAllowance)
  const head = truncateAtLineEnd(sliceHead(content, retained + 200), retained)
  return `${head}\n\n${buildFooter(head.length)}`
}

// ============================================
// 结构化收敛
// ============================================

/** 降级阶梯的一级。build 惰性求值，昂贵的载荷只在真的要用时才构造。 */
export interface JsonOutputStage {
  /** 该级的载荷。越靠后应当越省。 */
  build: () => unknown
  /**
   * 本级相比完整结果丢了什么、以及如何补回来。
   *
   * hint 的有无就是「这一级是否完整」的唯一判据：有 hint 就贴上 truncated 标记，
   * 没有就原样返回。这样第一级也能声明 hint —— 它常常本来就不完整（比如 max_matches
   * 已经截过一刀），把「第几级」和「是否完整」绑在一起会让那种情况漏报。
   *
   * 阶梯的意义不只是变小，而是「变小之后仍然可以继续查」。丢掉 body 就要告诉模型
   * 用 include_body 单独取，只剩计数就要告诉模型如何缩小范围重查。没有这句提示的
   * 降级等于让模型面对一个残缺结果自己猜下一步。
   */
  hint?: string
}

/** 阶梯全部塞不进预算时的兜底。构造上不可能超预算，因此结果一定合法。 */
function buildExhaustedEnvelope(budget: number): string {
  return JSON.stringify({
    truncated: true,
    truncationNotice: `The result does not fit in the ${budget} character budget even at the coarsest level. Narrow the query scope and retry.`,
  })
}

/**
 * 逐级尝试，返回第一个塞得进预算的载荷序列化结果。
 *
 * 返回值保证是合法 JSON —— 这是整个模块存在的理由。不做 pretty-print：缩进对模型
 * 没有价值，只是按 token 计费的空白。
 */
export function boundJsonOutput(stages: JsonOutputStage[], budget: number): string {
  const limit = clampOutputBudget(budget)

  for (const stage of stages) {
    const payload = stage.build()
    const serialized = stage.hint
      ? JSON.stringify(withTruncationNotice(payload, stage.hint))
      : JSON.stringify(payload)

    if (serialized.length <= limit) return serialized
  }

  return buildExhaustedEnvelope(limit)
}

/** 给降级载荷贴上机器可读的降级标记，让模型不必从字段缺失去推断发生了什么。 */
function withTruncationNotice(payload: unknown, hint: string | undefined): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { truncated: true, ...(hint ? { truncationNotice: hint } : {}), result: payload }
  }
  return {
    ...(payload as Record<string, unknown>),
    truncated: true,
    ...(hint ? { truncationNotice: hint } : {}),
  }
}

/**
 * 边界兜底：一个声明为 json 的结果超出了预算。
 *
 * 正常情况下执行器的阶梯已经把结果压进预算，走到这里说明有未预期的巨大载荷
 * （例如 MCP 工具，或某一级里嵌了超大字符串）。此时整体替换成一个合法信封，
 * 而绝不头尾拼接 —— 拼接产生的是不可解析的残骸。
 */
export function replaceOversizedJsonOutput(byteLength: number, budget: number): string {
  return JSON.stringify({
    truncated: true,
    truncationNotice: `The structured result was ${byteLength} characters, over the ${budget} character budget, and was dropped rather than cut mid-structure. Narrow the query scope and retry.`,
  })
}
