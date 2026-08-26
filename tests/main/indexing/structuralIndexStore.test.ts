import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import * as path from 'path'
import { executeStructuralIndexStoreOperation } from '@main/indexing/structuralIndexStore.worker'
import type { CodeChunk } from '@main/indexing/types'

function chunk(id: string, relativePath: string, content = `function ${id}() {}`): CodeChunk {
  return {
    id,
    filePath: path.join('C:/workspace', relativePath),
    relativePath,
    fileHash: `hash-${id}`,
    content,
    startLine: 1,
    endLine: 1,
    type: 'function',
    language: 'typescript',
    symbols: [id],
  }
}

describe('structural index SQLite store', () => {
  let directory: string
  let databasePath: string

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'adnify-structural-index-'))
    databasePath = path.join(directory, 'index.sqlite')
  })

  afterEach(async () => {
    try {
      executeStructuralIndexStoreOperation({ type: 'close', databasePath })
    } catch { /* database may already be closed */ }
    await rm(directory, { recursive: true, force: true })
  })

  function load(): { chunks: CodeChunk[]; metadata: unknown; batchSizes: number[] } {
    const chunks: CodeChunk[] = []
    const batchSizes: number[] = []
    let cursor: { relativePath: string; id: string } | undefined
    let metadata: unknown = null
    do {
      const result = executeStructuralIndexStoreOperation({ type: 'loadPage', databasePath, cursor })
      if (result.type !== 'loadedPage') throw new Error('Unexpected load result')
      metadata = result.metadata
      chunks.push(...result.chunks)
      if (result.chunks.length > 0) batchSizes.push(result.chunks.length)
      cursor = result.nextCursor || undefined
    } while (cursor)
    return {
      chunks,
      metadata,
      batchSizes,
    }
  }

  it('streams a committed generation in bounded batches', () => {
    const chunks = Array.from({ length: 125 }, (_, index) => chunk(`chunk-${index}`, `src/${index}.ts`))
    executeStructuralIndexStoreOperation({ type: 'beginReplace', databasePath, generation: 'one' })
    executeStructuralIndexStoreOperation({
      type: 'appendReplace', databasePath, generation: 'one', chunks,
    })
    executeStructuralIndexStoreOperation({
      type: 'commitReplace',
      databasePath,
      generation: 'one',
      metadata: { totalFiles: 125, totalChunks: 125, savedAt: 10 },
    })

    const loaded = load()
    expect(loaded.chunks).toHaveLength(125)
    expect(loaded.metadata).toEqual({ totalFiles: 125, totalChunks: 125, savedAt: 10 })
    expect(loaded.batchSizes).toEqual([50, 50, 25])
  })

  it('keeps the previous generation when a replacement is incomplete', () => {
    executeStructuralIndexStoreOperation({ type: 'beginReplace', databasePath, generation: 'stable' })
    executeStructuralIndexStoreOperation({
      type: 'appendReplace', databasePath, generation: 'stable', chunks: [chunk('stable', 'stable.ts')],
    })
    executeStructuralIndexStoreOperation({
      type: 'commitReplace',
      databasePath,
      generation: 'stable',
      metadata: { totalFiles: 1, totalChunks: 1, savedAt: 10 },
    })

    executeStructuralIndexStoreOperation({ type: 'beginReplace', databasePath, generation: 'broken' })
    executeStructuralIndexStoreOperation({
      type: 'appendReplace', databasePath, generation: 'broken', chunks: [chunk('partial', 'partial.ts')],
    })
    expect(() => executeStructuralIndexStoreOperation({
      type: 'commitReplace',
      databasePath,
      generation: 'broken',
      metadata: { totalFiles: 2, totalChunks: 2, savedAt: 20 },
    })).toThrow('Refusing incomplete structural index')

    const loaded = load()
    expect(loaded.chunks.map(item => item.id)).toEqual(['stable'])
    expect(loaded.metadata).toEqual({ totalFiles: 1, totalChunks: 1, savedAt: 10 })
  })

  it('replaces and deletes individual files atomically', () => {
    executeStructuralIndexStoreOperation({ type: 'beginReplace', databasePath, generation: 'base' })
    executeStructuralIndexStoreOperation({
      type: 'appendReplace',
      databasePath,
      generation: 'base',
      chunks: [chunk('a1', 'a.ts'), chunk('b1', 'b.ts')],
    })
    executeStructuralIndexStoreOperation({
      type: 'commitReplace',
      databasePath,
      generation: 'base',
      metadata: { totalFiles: 2, totalChunks: 2, savedAt: 10 },
    })
    executeStructuralIndexStoreOperation({
      type: 'applyFiles',
      databasePath,
      files: [
        { relativePath: 'a.ts', chunks: [chunk('a2', 'a.ts', 'function replacement() {}')] },
        { relativePath: 'b.ts', chunks: [] },
      ],
      metadata: { totalFiles: 2, totalChunks: 1, savedAt: 20 },
    })

    const loaded = load()
    expect(loaded.chunks.map(item => item.id)).toEqual(['a2'])
    expect(loaded.metadata).toEqual({ totalFiles: 2, totalChunks: 1, savedAt: 20 })
  })
})
