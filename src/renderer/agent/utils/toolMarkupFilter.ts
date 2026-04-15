const TOOL_CALL_OPEN_TAG = '<tool_call>'
const TOOL_CALL_CLOSE_TAG = '</tool_call>'

export interface ToolMarkupFilterResult {
  visibleText: string
  buffer: string
}

export function filterToolMarkupChunk(chunk: string, buffered = ''): ToolMarkupFilterResult {
  const combined = buffered + chunk
  let visibleText = ''
  let cursor = 0

  while (cursor < combined.length) {
    const start = combined.indexOf(TOOL_CALL_OPEN_TAG, cursor)
    if (start === -1) {
      visibleText += combined.slice(cursor)
      return { visibleText, buffer: '' }
    }

    visibleText += combined.slice(cursor, start)

    const end = combined.indexOf(TOOL_CALL_CLOSE_TAG, start)
    if (end === -1) {
      return { visibleText, buffer: combined.slice(start) }
    }

    cursor = end + TOOL_CALL_CLOSE_TAG.length
  }

  return { visibleText, buffer: '' }
}

export function stripToolMarkup(text: string): string {
  if (!text) return ''

  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<tool_call>[\s\S]*$/gi, '')
    .trim()
}
