import { describe, expect, it } from 'vitest'
import { applyLspTextEdits, collectWorkspaceTextEdits } from '../../src/shared/lsp/textEdits'

describe('LSP text edits', () => {
  it('applies multiple edits against the original document coordinates', () => {
    expect(applyLspTextEdits('const one = 1;\r\nconst two = 2;\r\n', [
      { range: { start: { line: 1, character: 6 }, end: { line: 1, character: 9 } }, newText: 'second' },
      { range: { start: { line: 0, character: 6 }, end: { line: 0, character: 9 } }, newText: 'first' },
    ])).toBe('const first = 1;\r\nconst second = 2;\r\n')
  })

  it('rejects stale, invalid, and overlapping ranges', () => {
    expect(() => applyLspTextEdits('abc', [
      { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } }, newText: '' },
      { range: { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } }, newText: '' },
    ])).toThrow(/Overlapping/)
    expect(() => applyLspTextEdits('abc', [
      { range: { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } }, newText: '' },
    ])).toThrow(/outside/)
  })

  it('merges changes and text document edits by URI', () => {
    const edit = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'x' }
    const collected = collectWorkspaceTextEdits({
      changes: { 'file:///a.ts': [edit] },
      documentChanges: [{ textDocument: { uri: 'file:///a.ts' }, edits: [edit] }],
    })
    expect(collected.get('file:///a.ts')).toHaveLength(2)
  })
})
