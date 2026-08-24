import { describe, expect, it } from 'vitest'
import { parseSymbolToolResult } from '@/renderer/agent/presentation/symbolToolDisplay'

describe('parseSymbolToolResult', () => {
  it('extracts paths and locations from find_symbol results', () => {
    const symbols = parseSymbolToolResult(JSON.stringify({
      matchedCount: 1,
      symbols: [{
        name: 'streamReply',
        namePath: 'ModelAssistantResponder/streamReply',
        kindName: 'Method',
        relativePath: 'src/infrastructure/llm/ModelAssistantResponder.ts',
        range: { start: { line: 87, column: 3 } },
      }],
    }))

    expect(symbols).toEqual([expect.objectContaining({
      namePath: 'ModelAssistantResponder/streamReply',
      relativePath: 'src/infrastructure/llm/ModelAssistantResponder.ts',
      line: 87,
    })])
  })

  it('returns no preview items for plain status text or malformed JSON', () => {
    expect(parseSymbolToolResult('No matching symbols found')).toEqual([])
    expect(parseSymbolToolResult('{')).toEqual([])
  })
})
