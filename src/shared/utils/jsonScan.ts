/**
 * 一份「转义与字符串感知」的 JSON 括号扫描器。
 *
 * 为什么要收成一份：流式工具调用参数天然是**不完整的 JSON**，所以这条链路上到处都要
 * 回答同一类问题——「这个 `{` 的配对在哪」「这段截断的 JSON 缺哪些收尾」。之前仓库里
 * 有四份各自手写的扫描循环（主进程适配器、渲染端参数解析器、jsonUtils 的两个修复函数），
 * 外加 `experimental_repairToolCall` 里一个**朴素正则计数器**——它不认转义也不认字符串，
 * 于是 `{"path":"a}b"}` 这种参数会被它判成缺一个 `}`，补出来的 JSON 直接坏掉，而同一个
 * 文件里几十行外就躺着一份正确实现。
 *
 * 语义只有一条：`"` 切换字符串状态，`\` 只在字符串内部生效（这就是 JSON 的规则），
 * 括号只在字符串外部计数。空栈上遇到多余的闭括号一律忽略，不让栈变成负数。
 */

export type JsonOpenBracket = '{' | '['

export interface JsonScanResult {
  /** 扫描结束时仍未闭合的括号，栈顶在末尾 */
  openStack: JsonOpenBracket[]
  /** 扫描结束时是否停在字符串内部 */
  inString: boolean
  /** 是否停在一个孤立的反斜杠之后（字符串内的转义还没写完） */
  escaped: boolean
  /** 最后一次栈归零的下标，即最后一个完整顶层结构的闭括号位置；没有则 -1 */
  lastCompleteEnd: number
}

interface ScanOptions {
  startIndex?: number
  /** 栈第一次归零就停下——findJsonValueEnd 用它，避免整段扫完 */
  stopAtTopLevelEnd?: boolean
}

function scan(text: string, options: ScanOptions = {}): JsonScanResult {
  const { startIndex = 0, stopAtTopLevelEnd = false } = options
  const openStack: JsonOpenBracket[] = []
  let inString = false
  let escaped = false
  let lastCompleteEnd = -1

  for (let i = Math.max(0, startIndex); i < text.length; i++) {
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

    if (ch === '{' || ch === '[') {
      openStack.push(ch)
      continue
    }

    if (ch === '}' || ch === ']') {
      // 多余的闭括号（栈空）直接忽略：让栈变负数只会让后面的判断全部失真
      if (openStack.length === 0) continue
      openStack.pop()
      if (openStack.length === 0) {
        lastCompleteEnd = i
        if (stopAtTopLevelEnd) break
      }
    }
  }

  return { openStack, inString, escaped, lastCompleteEnd }
}

export function scanJson(text: string, startIndex = 0): JsonScanResult {
  return scan(text, { startIndex })
}

/**
 * `startIndex` 处的 `{` / `[` 的配对下标，未闭合返回 -1。
 *
 * 起始字符不是开括号时也返回 -1——调用方拿到的是「这里没有一个完整的值」，而不是
 * 从别处开始的某个配对。
 */
export function findJsonValueEnd(text: string, startIndex: number): number {
  const opener = text[startIndex]
  if (opener !== '{' && opener !== '[') return -1

  const result = scan(text, { startIndex, stopAtTopLevelEnd: true })
  return result.openStack.length === 0 ? result.lastCompleteEnd : -1
}

/**
 * 切出 `startIndex` 处的 JSON 值。
 *
 * 流式场景要的是「切到哪，闭合了没有」两个信息：闭合了就是完整载荷可以 JSON.parse，
 * 没闭合就把剩下的整段给调用方去做部分解析。
 */
export function sliceJsonValue(
  text: string,
  startIndex: number,
): { slice: string; complete: boolean } | null {
  const opener = text[startIndex]
  if (opener !== '{' && opener !== '[') return null

  const end = findJsonValueEnd(text, startIndex)
  return end >= 0
    ? { slice: text.slice(startIndex, end + 1), complete: true }
    : { slice: text.slice(startIndex), complete: false }
}

/**
 * 给截断的 JSON 补上收尾：未闭合的字符串补引号，未闭合的括号**按栈序**补。
 *
 * 按栈序这一点是必须的：`[{"a":1` 缺的是 `}` 再 `]`，按「先补所有方括号再补所有花括号」
 * 会产出 `[{"a":1]}`，比不补还糟——它能通过括号计数，但 JSON.parse 依旧失败。
 */
export function closeUnterminatedJson(text: string): string {
  const state = scanJson(text)
  let result = text

  if (state.inString) {
    // 末尾是个孤立的反斜杠：先把它补成合法转义，否则补的引号会被它吃掉
    if (state.escaped) result += '\\'
    result += '"'
  }

  for (let i = state.openStack.length - 1; i >= 0; i--) {
    result += state.openStack[i] === '{' ? '}' : ']'
  }

  return result
}
