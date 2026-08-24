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

  it('reads compact nested document symbols and inherits the document path', () => {
    const symbols = parseSymbolToolResult(JSON.stringify({
      relativePath: 'src/cache.ts',
      symbols: [{
        namePath: 'Cache',
        kind: 'Class',
        range: '3:1-12:2',
        children: [{ namePath: 'Cache/get', kind: 'Method', range: '5:3-7:4' }],
      }],
    }))

    expect(symbols).toEqual([
      expect.objectContaining({ namePath: 'Cache', kindName: 'Class', relativePath: 'src/cache.ts', line: 3 }),
      expect.objectContaining({ namePath: 'Cache/get', kindName: 'Method', relativePath: 'src/cache.ts', line: 5 }),
    ])
  })

  it('extracts path and line from compact find-symbol locations', () => {
    const [symbol] = parseSymbolToolResult(JSON.stringify({
      symbols: [{
        namePath: 'Gateway/stream',
        kind: 'Method',
        range: '9:3-20:4',
        location: 'src/llm/Gateway.ts:9:3-20:4',
      }],
    }))

    expect(symbol).toMatchObject({ relativePath: 'src/llm/Gateway.ts', line: 9 })
  })
})
