import { describe, expect, it } from 'vitest'
import { SymbolIndex } from '@main/indexing/search/symbolIndex'
import type { SymbolInfo } from '@main/indexing/types'

function symbol(name: string, relativePath: string): SymbolInfo {
  return {
    name,
    kind: 'function',
    filePath: `/workspace/${relativePath}`,
    relativePath,
    startLine: 1,
    endLine: 1,
  }
}

describe('SymbolIndex streaming serialization', () => {
  it('matches the regular JSON representation and round-trips', () => {
    const index = new SymbolIndex()
    index.add(symbol('openWorkspace', 'src/workspace.ts'))
    index.add(symbol('closeWorkspace', 'src/workspace.ts'))
    index.add(symbol('openFile', 'src/files.ts'))

    const encoded = Array.from(index.toJSONChunks()).join('')
    expect(encoded).toBe(JSON.stringify(index.toJSON()))

    const restored = new SymbolIndex()
    restored.fromJSON(JSON.parse(encoded))
    expect(restored.search('open')).toEqual(index.search('open'))
    expect(restored.getFileSymbols('src/workspace.ts')).toEqual(
      index.getFileSymbols('src/workspace.ts'),
    )
  })
})
