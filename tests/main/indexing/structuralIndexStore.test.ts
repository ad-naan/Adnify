import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import * as path from 'path'
import { DatabaseSync } from 'node:sqlite'
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
    const chunks = Array.from({ length: 1025 }, (_, index) => chunk(`chunk-${index}`, `src/${index}.ts`))
    executeStructuralIndexStoreOperation({ type: 'beginReplace', databasePath, generation: 'one' })
    executeStructuralIndexStoreOperation({
      type: 'appendReplace', databasePath, generation: 'one', chunks,
    })
    executeStructuralIndexStoreOperation({
      type: 'commitReplace',
      databasePath,
      generation: 'one',
      metadata: { totalFiles: 1025, totalChunks: 1025, savedAt: 10 },
    })

    const loaded = load()
    expect(loaded.chunks).toHaveLength(1025)
    expect(loaded.metadata).toEqual({ totalFiles: 1025, totalChunks: 1025, savedAt: 10 })
    expect(loaded.batchSizes).toEqual([512, 512, 1])
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

  it('stores file metadata once and uses the tuned database layout', () => {
    executeStructuralIndexStoreOperation({ type: 'beginReplace', databasePath, generation: 'layout' })
    executeStructuralIndexStoreOperation({
      type: 'appendReplace',
      databasePath,
      generation: 'layout',
      chunks: [
        chunk('part-1', 'shared.ts'),
        { ...chunk('part-2', 'shared.ts'), startLine: 2, endLine: 2 },
      ],
    })
    executeStructuralIndexStoreOperation({
      type: 'commitReplace',
      databasePath,
      generation: 'layout',
      metadata: { totalFiles: 1, totalChunks: 2, savedAt: 10 },
    })

    const database = new DatabaseSync(databasePath, { readOnly: true })
    try {
      const fileCount = database.prepare('SELECT COUNT(*) AS count FROM files').get() as { count: number }
      const chunkCount = database.prepare('SELECT COUNT(*) AS count FROM chunks').get() as { count: number }
      const columns = database.prepare("PRAGMA table_info('chunks')").all() as Array<{ name: string }>
      const pageSize = database.prepare('PRAGMA page_size').get() as { page_size: number }
      const journalMode = database.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
      const pagePlan = database.prepare(`
        EXPLAIN QUERY PLAN
        SELECT * FROM chunks
        WHERE generation = ? AND (relative_path, id) > (?, ?)
        ORDER BY relative_path, id LIMIT ?
      `).all('generation-layout', '', '', 512) as Array<{ detail: string }>

      expect(Number(fileCount.count)).toBe(1)
      expect(Number(chunkCount.count)).toBe(2)
      expect(columns.map(column => column.name)).not.toContain('payload_json')
      expect(Number(pageSize.page_size)).toBe(8192)
      expect(journalMode.journal_mode).toBe('wal')
      expect(pagePlan.map(row => row.detail).join('\n'))
        .toContain('PRIMARY KEY (generation=? AND (relative_path,id)>(?,?))')
    } finally {
      database.close()
    }
  })
})
