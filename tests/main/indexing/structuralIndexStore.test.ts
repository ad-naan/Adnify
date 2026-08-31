import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import * as path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { executeStructuralIndexStoreOperation } from '@main/indexing/structuralIndexStore.worker'
import type { CodeChunk } from '@main/indexing/types'

const projectSummary = {
  name: 'workspace',
  structure: [],
  keyFiles: [],
  totalFiles: 1025,
  totalSymbols: 1025,
  languages: { typescript: 1025 },
  generatedAt: 10,
}

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
      if (metadata === null) metadata = result.metadata
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
      metadata: { totalFiles: 1025, totalChunks: 1025, savedAt: 10, projectSummary },
    })

    const loaded = load()
    expect(loaded.chunks).toHaveLength(1025)
    expect(loaded.metadata).toEqual({ totalFiles: 1025, totalChunks: 1025, savedAt: 10, projectSummary })
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

  // 回归：chunk id 是 `${filePath}:${startRow}`，TS/JS 查询对每个 export 声明
  // 会双重捕获（function_declaration + export_statement），产生同 id 的块。
  // 上游 treeSitterChunker 已按 id 去重，这里是最后一道兜底：单个重复 id
  // 不应该以 UNIQUE constraint failed 把整个索引构建带崩。
  it('tolerates a repeated chunk id instead of aborting the whole build', () => {
    executeStructuralIndexStoreOperation({ type: 'beginReplace', databasePath, generation: 'dup' })
    expect(() => executeStructuralIndexStoreOperation({
      type: 'appendReplace',
      databasePath,
      generation: 'dup',
      chunks: [
        chunk('same', 'a.ts', 'export class Foo {}'),
        chunk('same', 'a.ts', 'class Foo {}'),
        chunk('other', 'a.ts'),
      ],
    })).not.toThrow()

    // indexService 汇报的 totalChunks 是 bm25Index.size，而 BM25 按 id 建索引，
    // 重复块在两侧都折叠成一行，所以 commitReplace 的 COUNT(*) 校验依然平衡。
    executeStructuralIndexStoreOperation({
      type: 'commitReplace',
      databasePath,
      generation: 'dup',
      metadata: { totalFiles: 1, totalChunks: 2, savedAt: 10 },
    })

    const loaded = load()
    expect(loaded.chunks.map(item => item.id)).toEqual(['other', 'same'])
    expect(loaded.chunks.find(item => item.id === 'same')?.content).toBe('class Foo {}')
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

  it('migrates schema v2 in place without deleting a committed index', () => {
    const legacy = new DatabaseSync(databasePath)
    legacy.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE index_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        active_generation TEXT NOT NULL,
        total_files INTEGER NOT NULL,
        total_chunks INTEGER NOT NULL,
        saved_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE files (
        generation TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_hash TEXT NOT NULL,
        PRIMARY KEY (generation, relative_path)
      ) WITHOUT ROWID, STRICT;
      CREATE TABLE chunks (
        generation TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        id TEXT NOT NULL,
        content TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        type TEXT NOT NULL,
        language TEXT NOT NULL,
        symbols_json TEXT NOT NULL,
        PRIMARY KEY (generation, relative_path, id),
        FOREIGN KEY (generation, relative_path)
          REFERENCES files(generation, relative_path) ON DELETE CASCADE
      ) WITHOUT ROWID, STRICT;
      INSERT INTO index_state VALUES (1, 'stable', 1, 1, 10);
      INSERT INTO files VALUES ('stable', 'a.ts', 'C:/workspace/a.ts', 'hash-a');
      INSERT INTO chunks VALUES (
        'stable', 'a.ts', 'a', 'function a() {}', 1, 1,
        'function', 'typescript', '["a"]'
      );
      PRAGMA user_version = 2;
    `)
    legacy.close()

    const loaded = load()
    expect(loaded.chunks.map(item => item.id)).toEqual(['a'])
    expect(loaded.metadata).toEqual({ totalFiles: 1, totalChunks: 1, savedAt: 10 })

    const migrated = new DatabaseSync(databasePath, { readOnly: true })
    try {
      const version = migrated.prepare('PRAGMA user_version').get() as { user_version: number }
      const columns = migrated.prepare("PRAGMA table_info('index_state')").all() as Array<{ name: string }>
      expect(Number(version.user_version)).toBe(3)
      expect(columns.map(column => column.name)).toContain('project_summary_json')
    } finally {
      migrated.close()
    }
  })

  it('discards an incompatible cache schema instead of retaining legacy keys', () => {
    const legacy = new DatabaseSync(databasePath)
    legacy.exec(`
      CREATE TABLE legacy_index(relative_path TEXT PRIMARY KEY);
      PRAGMA user_version = 1;
    `)
    legacy.close()

    expect(load()).toEqual({ chunks: [], metadata: null, batchSizes: [] })

    const rebuilt = new DatabaseSync(databasePath, { readOnly: true })
    try {
      const version = rebuilt.prepare('PRAGMA user_version').get() as { user_version: number }
      expect(Number(version.user_version)).toBe(3)
    } finally {
      rebuilt.close()
    }
  })
})
