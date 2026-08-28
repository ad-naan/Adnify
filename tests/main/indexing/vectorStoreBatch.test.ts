import { describe, expect, it, vi } from 'vitest'
import { VectorStoreService } from '@main/indexing/vectorStore'
import type { IndexedChunk } from '@main/indexing/types'

function chunk(filePath: string, id: string): IndexedChunk {
  return {
    id,
    filePath,
    relativePath: filePath,
    fileHash: `hash-${id}`,
    content: `content-${id}`,
    startLine: 1,
    endLine: 1,
    type: 'block',
    language: 'typescript',
    symbols: [],
    vector: [1, 2, 3],
  }
}

describe('VectorStoreService batch updates', () => {
  it('replaces several files with one delete and one add', async () => {
    const table = { delete: vi.fn(async (_filter: string) => {}), add: vi.fn(async (_data: unknown[]) => {}) }
    const store = new VectorStoreService('C:/workspace-cache')
    Object.assign(store as unknown as Record<string, unknown>, { db: {}, table })

    await store.upsertFiles([
      { filePath: 'src/a.ts', chunks: [chunk('src/a.ts', 'a')] },
      { filePath: 'src/b.ts', chunks: [chunk('src/b.ts', 'b')] },
    ])

    expect(table.delete).toHaveBeenCalledTimes(1)
    expect(table.delete).toHaveBeenCalledWith("filePath = 'src/a.ts' OR filePath = 'src/b.ts'")
    expect(table.add).toHaveBeenCalledTimes(1)
    expect(table.add.mock.calls[0][0]).toHaveLength(2)
  })

  it('does not add rows when a batch only deletes files', async () => {
    const table = { delete: vi.fn(async (_filter: string) => {}), add: vi.fn(async (_data: unknown[]) => {}) }
    const store = new VectorStoreService('C:/workspace-cache')
    Object.assign(store as unknown as Record<string, unknown>, { db: {}, table })

    await store.upsertFiles([{ filePath: 'src/deleted.ts', chunks: [] }])

    expect(table.delete).toHaveBeenCalledTimes(1)
    expect(table.add).not.toHaveBeenCalled()
  })
})
