import { describe, expect, it } from 'vitest'
import {
  sanitizeToolRichContent,
  sanitizeToolTextOutput,
} from '@renderer/agent/tools/toolOutputSanitizer'

describe('toolOutputSanitizer', () => {
  it('removes terminal and unsafe control sequences without damaging Unicode', () => {
    const input = '\x1b[32m中文 output\x1b[0m\x00\u0085\u202e ok \ud800'

    expect(sanitizeToolTextOutput(input)).toBe('中文 output ok �')
  })

  it('sanitizes textual rich content but preserves image payload data', () => {
    const result = sanitizeToolRichContent([
      { type: 'markdown', text: '\x1b[31m标题\x1b[0m', data: '正文\x00' },
      { type: 'image', title: '预览\x00', data: 'AA\x00BB', mimeType: 'image/png' },
      { type: 'table', tableData: { headers: ['\x1b[1m列\x1b[0m'], rows: [['值\x00']] } },
    ])

    expect(result).toEqual([
      { type: 'markdown', text: '标题', data: '正文' },
      { type: 'image', title: '预览', data: 'AA\x00BB', mimeType: 'image/png' },
      { type: 'table', tableData: { headers: ['列'], rows: [['值']] } },
    ])
  })
})
