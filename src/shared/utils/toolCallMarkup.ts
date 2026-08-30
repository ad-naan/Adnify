/**
 * 「工具调用被当成正文吐出来」时的标签词表——两端唯一的来源。
 *
 * 这条链路上有两个方向相反的消费者，以前各自硬编码一份词表：
 *   - 主进程 [pseudoToolCallAdapter] **转换**：把泄漏的载荷还原成标准 tool-call 事件；
 *   - 渲染端 [toolCallLeakFilter] **剥离**：把没能还原的残留标记从正文里删掉。
 * 两份词表不一致的后果是静默的：主进程认不出的标签会当正文上线，渲染端再把它删掉，
 * 于是这次工具调用**看起来什么都没发生**。所以词表放在一起，并写清各自取哪个子集。
 */

/** provider 泄漏到正文里的全部标签（小写，不含尖括号） */
export const TOOL_CALL_MARKUP_TAGS = [
  'function_calls',
  'function_call',
  'tool_calls',
  'tool_call',
] as const

export type ToolCallMarkupTag = typeof TOOL_CALL_MARKUP_TAGS[number]

/**
 * 载荷是 JSON、因而**可以被还原成真工具调用**的那些标签。
 *
 * 只有 `<tool_call>` 在这个子集里：其余三个是 Anthropic 风格的嵌套 XML
 * （`<invoke><parameter name="...">`），还原它们要的是另一个解析器，不是 JSON.parse。
 * 主进程只对这个子集做转换，其余的走渲染端剥离——这不是遗漏，是分工。
 */
export const JSON_PAYLOAD_MARKUP_TAGS = ['tool_call'] as const satisfies readonly ToolCallMarkupTag[]

export function markupOpenTag(tag: ToolCallMarkupTag): string {
  return `<${tag}>`
}

export function markupCloseTag(tag: ToolCallMarkupTag): string {
  return `</${tag}>`
}
