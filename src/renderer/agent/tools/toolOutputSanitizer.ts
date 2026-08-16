import type { ToolRichContent } from '@/shared/types'
import { stripAnsi } from '@/renderer/services/terminalTextExtraction'

const C1_CONTROL_RE = /[\u007f-\u009f]/g
const BIDI_CONTROL_RE = /[\u202a-\u202e\u2066-\u2069]/g

function replaceLoneSurrogates(value: string): string {
  let output = ''

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += value[index] + value[index + 1]
        index += 1
      } else {
        output += '\ufffd'
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      output += '\ufffd'
    } else {
      output += value[index]
    }
  }

  return output
}

/**
 * Clean untrusted textual tool output before it reaches either the UI or the
 * next model request. This deliberately does not guess legacy encodings: that
 * must be fixed where bytes enter the process, before they become a string.
 */
export function sanitizeToolTextOutput(value: string): string {
  return replaceLoneSurrogates(stripAnsi(value))
    .replace(C1_CONTROL_RE, '')
    .replace(BIDI_CONTROL_RE, '')
}

export function sanitizeToolRichContent(
  richContent: ToolRichContent[] | undefined,
): ToolRichContent[] | undefined {
  if (!richContent) return undefined

  return richContent.map(item => ({
    ...item,
    text: item.text === undefined ? undefined : sanitizeToolTextOutput(item.text),
    title: item.title === undefined ? undefined : sanitizeToolTextOutput(item.title),
    data: item.data === undefined || item.type === 'image'
      ? item.data
      : sanitizeToolTextOutput(item.data),
    tableData: item.tableData
      ? {
          headers: item.tableData.headers.map(sanitizeToolTextOutput),
          rows: item.tableData.rows.map(row => row.map(sanitizeToolTextOutput)),
        }
      : undefined,
  }))
}
