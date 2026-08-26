import { describe, expect, it } from 'vitest'
import {
  stripToolCallLeaks,
  ToolCallLeakFilter,
} from '@/renderer/agent/utils/toolCallLeakFilter'

function filterChunks(chunks: string[]): string {
  const filter = new ToolCallLeakFilter()
  return chunks.map(chunk => filter.consume(chunk)).join('') + filter.finalize()
}

describe('ToolCallLeakFilter', () => {
  it('removes every supported tool markup form', () => {
    const input = [
      'before ',
      '<tool_call>hidden</tool_call>',
      '<tool_calls>hidden</tool_calls>',
      '<function_call>hidden</function_call>',
      '<function_calls>hidden</function_calls>',
      ' after',
    ].join('')

    expect(stripToolCallLeaks(input)).toBe('before  after')
  })

  it('recognizes opening, attributes, payload, and closing tags split at every character', () => {
    const input = 'before <TOOL_CALL id="write-1">very large hidden payload</TOOL_CALL> after'

    expect(filterChunks([...input])).toBe('before  after')
  })

  it('handles multiple tags and visible text in the same chunk sequence', () => {
    expect(filterChunks([
      'a<tool_',
      'call>x</tool_',
      'call>b<function_calls>',
      'y</function_calls>c',
    ])).toBe('abc')
  })

  it('preserves ordinary angle-bracket text', () => {
    const input = 'a < b, <div>content</div>, and generic<T>()'
    expect(filterChunks([...input])).toBe(input)
  })

  it('flushes an incomplete possible tag as visible text', () => {
    expect(filterChunks(['text <tool_'])).toBe('text <tool_')
  })

  it('drops an opened tag whose hidden payload never closes', () => {
    expect(filterChunks(['visible<tool_call>', 'hidden forever'])).toBe('visible')
  })
})
