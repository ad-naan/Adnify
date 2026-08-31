import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, rmSync } from 'fs'
import * as path from 'path'
import { parentPort } from 'worker_threads'
import type { CodeChunk } from './types'
import type {
  StructuralIndexCursor,
  StructuralIndexMetadata,
  StructuralIndexStoreMessage,
  StructuralIndexStoreOperation,
  StructuralIndexStoreRequest,
  StructuralIndexStoreResult,
} from './structuralIndexStore.types'

const databases = new Map<string, DatabaseSync>()
// Keep worker IPC amortized without creating multi-megabyte structured-clone
// payloads for the main process. The old size of 50 made a 1M-chunk cache
// require 20,000 request/response turns during startup.
const LOAD_BATCH_SIZE = 512
const SCHEMA_VERSION = 3

interface StoredChunkRow {
  id: string
  relative_path: string
  file_path: string
  file_hash: string
  content: string
  start_line: number
  end_line: number
  type: CodeChunk['type']
  language: string
  symbols_json: string
}

function removeDatabaseFiles(databasePath: string): void {
  for (const target of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    rmSync(target, { force: true })
  }
}

function hasTables(database: DatabaseSync): boolean {
  return Boolean(database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' LIMIT 1",
  ).get())
}

function createSchema(database: DatabaseSync): void {
  database.exec(`
    PRAGMA page_size = 8192;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA temp_store = MEMORY;
    PRAGMA busy_timeout = 5000;
    PRAGMA cache_size = -32768;
    PRAGMA mmap_size = 268435456;
    PRAGMA wal_autocheckpoint = 4096;
    PRAGMA journal_size_limit = 16777216;

    CREATE TABLE index_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      active_generation TEXT NOT NULL,
      total_files INTEGER NOT NULL CHECK (total_files >= 0),
      total_chunks INTEGER NOT NULL CHECK (total_chunks >= 0),
      saved_at INTEGER NOT NULL,
      project_summary_json TEXT
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
      start_line INTEGER NOT NULL CHECK (start_line >= 0),
      end_line INTEGER NOT NULL CHECK (end_line >= start_line),
      type TEXT NOT NULL,
      language TEXT NOT NULL,
      symbols_json TEXT NOT NULL,
      PRIMARY KEY (generation, relative_path, id),
      FOREIGN KEY (generation, relative_path)
        REFERENCES files(generation, relative_path) ON DELETE CASCADE
    ) WITHOUT ROWID, STRICT;

    PRAGMA user_version = ${SCHEMA_VERSION};
  `)
}

function openDatabase(databasePath: string): DatabaseSync {
  const existing = databases.get(databasePath)
  if (existing) return existing

  mkdirSync(path.dirname(databasePath), { recursive: true })
  let database = new DatabaseSync(databasePath)
  const version = Number(
    (database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
  )
  if (version === 2 && hasTables(database)) {
    database.exec(`
      ALTER TABLE index_state ADD COLUMN project_summary_json TEXT;
      PRAGMA user_version = ${SCHEMA_VERSION};
    `)
  } else if (version !== SCHEMA_VERSION && (version !== 0 || hasTables(database))) {
    database.close()
    removeDatabaseFiles(databasePath)
    database = new DatabaseSync(databasePath)
  }
  if (!hasTables(database)) createSchema(database)
  else database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA temp_store = MEMORY;
    PRAGMA busy_timeout = 5000;
    PRAGMA cache_size = -32768;
    PRAGMA mmap_size = 268435456;
    PRAGMA wal_autocheckpoint = 4096;
    PRAGMA journal_size_limit = 16777216;
  `)
  // A terminated rebuild may leave an uncommitted generation behind. Only the
  // active generation is authoritative, so orphan rows are safe to remove.
  database.exec(`
    DELETE FROM files
    WHERE generation NOT IN (SELECT active_generation FROM index_state WHERE singleton = 1)
  `)
  databases.set(databasePath, database)
  return database
}

function inTransaction(database: DatabaseSync, operation: () => void): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    operation()
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function createChunkStatements(database: DatabaseSync) {
  const insertFile = database.prepare(`
    INSERT INTO files(generation, relative_path, file_path, file_hash)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(generation, relative_path) DO UPDATE SET
      file_path = excluded.file_path,
      file_hash = excluded.file_hash
  `)
  // Last write wins on a repeated chunk id instead of aborting the transaction.
  // A duplicate id used to fail the whole appendReplace batch with
  // `UNIQUE constraint failed`, which aborts the entire index build — a very
  // expensive way to react to one colliding row. The upsert is also consistent
  // with the caller's chunk count: indexService reports `bm25Index.size`, and
  // BM25 keys documents by id, so a duplicate collapses to one row on both
  // sides and commitReplace's COUNT(*) check still balances.
  const insertChunk = database.prepare(`
    INSERT INTO chunks(
      generation, relative_path, id, content, start_line, end_line,
      type, language, symbols_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(generation, relative_path, id) DO UPDATE SET
      content = excluded.content,
      start_line = excluded.start_line,
      end_line = excluded.end_line,
      type = excluded.type,
      language = excluded.language,
      symbols_json = excluded.symbols_json
  `)
  return { insertFile, insertChunk }
}

function insertChunks(
  statements: ReturnType<typeof createChunkStatements>,
  generation: string,
  chunks: CodeChunk[],
): void {
  const { insertFile, insertChunk } = statements
  const insertedFiles = new Set<string>()
  for (const chunk of chunks) {
    if (!insertedFiles.has(chunk.relativePath)) {
      insertFile.run(generation, chunk.relativePath, chunk.filePath, chunk.fileHash)
      insertedFiles.add(chunk.relativePath)
    }
    insertChunk.run(
      generation,
      chunk.relativePath,
      chunk.id,
      chunk.content,
      chunk.startLine,
      chunk.endLine,
      chunk.type,
      chunk.language,
      JSON.stringify(chunk.symbols || []),
    )
  }
}

function readMetadata(
  database: DatabaseSync,
  includeProjectSummary = true,
): (StructuralIndexMetadata & { generation: string }) | null {
  const row = database.prepare(`
    SELECT active_generation, total_files, total_chunks, saved_at, project_summary_json
    FROM index_state WHERE singleton = 1
  `).get() as {
    active_generation: string
    total_files: number
    total_chunks: number
    saved_at: number
    project_summary_json: string | null
  } | undefined
  return row ? {
    generation: row.active_generation,
    totalFiles: row.total_files,
    totalChunks: row.total_chunks,
    savedAt: row.saved_at,
    ...(includeProjectSummary && row.project_summary_json
      ? { projectSummary: JSON.parse(row.project_summary_json) as StructuralIndexMetadata['projectSummary'] }
      : {}),
  } : null
}

function loadPage(
  database: DatabaseSync,
  cursor?: StructuralIndexCursor,
): StructuralIndexStoreResult {
  const metadata = readMetadata(database, !cursor)
  if (!metadata) {
    return { type: 'loadedPage', metadata: null, chunks: [], nextCursor: null }
  }

  const rows = cursor
    ? database.prepare(`
        SELECT
          c.id, c.relative_path, f.file_path, f.file_hash, c.content,
          c.start_line, c.end_line, c.type, c.language, c.symbols_json
        FROM chunks c
        JOIN files f USING (generation, relative_path)
        WHERE c.generation = ?
          AND (c.relative_path, c.id) > (?, ?)
        ORDER BY c.relative_path, c.id LIMIT ?
      `).all(
        metadata.generation,
        cursor.relativePath,
        cursor.id,
        LOAD_BATCH_SIZE,
      ) as unknown as StoredChunkRow[]
    : database.prepare(`
        SELECT
          c.id, c.relative_path, f.file_path, f.file_hash, c.content,
          c.start_line, c.end_line, c.type, c.language, c.symbols_json
        FROM chunks c
        JOIN files f USING (generation, relative_path)
        WHERE c.generation = ? ORDER BY c.relative_path, c.id LIMIT ?
      `).all(metadata.generation, LOAD_BATCH_SIZE) as unknown as StoredChunkRow[]
  const { generation: _generation, ...result } = metadata
  const last = rows.at(-1)
  return {
    type: 'loadedPage',
    metadata: result,
    chunks: rows.map(row => ({
      id: row.id,
      filePath: row.file_path,
      relativePath: row.relative_path,
      fileHash: row.file_hash,
      content: row.content,
      startLine: row.start_line,
      endLine: row.end_line,
      type: row.type,
      language: row.language,
      symbols: JSON.parse(row.symbols_json) as string[],
    })),
    nextCursor: rows.length === LOAD_BATCH_SIZE && last
      ? { relativePath: last.relative_path, id: last.id }
      : null,
  }
}

export function executeStructuralIndexStoreOperation(
  operation: StructuralIndexStoreOperation,
): StructuralIndexStoreResult {
  const database = openDatabase(operation.databasePath)
  switch (operation.type) {
    case 'loadPage':
      return loadPage(database, operation.cursor)
    case 'beginReplace':
      database.prepare('DELETE FROM files WHERE generation = ?').run(operation.generation)
      return { type: 'ok' }
    case 'appendReplace':
      inTransaction(database, () => {
        insertChunks(createChunkStatements(database), operation.generation, operation.chunks)
      })
      return { type: 'ok' }
    case 'commitReplace': {
      const row = database.prepare(
        'SELECT COUNT(*) AS count FROM chunks WHERE generation = ?',
      ).get(operation.generation) as { count: number }
      if (Number(row.count) !== operation.metadata.totalChunks) {
        throw new Error(
          `Refusing incomplete structural index: expected ${operation.metadata.totalChunks} chunks, got ${row.count}`,
        )
      }
      inTransaction(database, () => {
        database.prepare(`
          INSERT INTO index_state(
            singleton, active_generation, total_files, total_chunks, saved_at, project_summary_json
          ) VALUES (1, ?, ?, ?, ?, ?)
          ON CONFLICT(singleton) DO UPDATE SET
            active_generation = excluded.active_generation,
            total_files = excluded.total_files,
            total_chunks = excluded.total_chunks,
            saved_at = excluded.saved_at,
            project_summary_json = excluded.project_summary_json
        `).run(
          operation.generation,
          operation.metadata.totalFiles,
          operation.metadata.totalChunks,
          operation.metadata.savedAt,
          operation.metadata.projectSummary ? JSON.stringify(operation.metadata.projectSummary) : null,
        )
        database.prepare('DELETE FROM files WHERE generation <> ?').run(operation.generation)
      })
      return { type: 'ok' }
    }
    case 'abortReplace':
      database.prepare('DELETE FROM files WHERE generation = ?').run(operation.generation)
      return { type: 'ok' }
    case 'applyFiles': {
      const current = readMetadata(database)
      const generation = current?.generation || `incremental-${operation.metadata.savedAt}`
      inTransaction(database, () => {
        const statements = createChunkStatements(database)
        const remove = database.prepare(
          'DELETE FROM files WHERE generation = ? AND relative_path = ?',
        )
        for (const file of operation.files) {
          remove.run(generation, file.relativePath)
          insertChunks(statements, generation, file.chunks)
        }
        const row = database.prepare(
          'SELECT COUNT(*) AS count FROM chunks WHERE generation = ?',
        ).get(generation) as { count: number }
        if (Number(row.count) !== operation.metadata.totalChunks) {
          throw new Error(
            `Refusing inconsistent structural update: expected ${operation.metadata.totalChunks} chunks, got ${row.count}`,
          )
        }
        database.prepare(`
          INSERT INTO index_state(
            singleton, active_generation, total_files, total_chunks, saved_at, project_summary_json
          ) VALUES (1, ?, ?, ?, ?, ?)
          ON CONFLICT(singleton) DO UPDATE SET
            total_files = excluded.total_files,
            total_chunks = excluded.total_chunks,
            saved_at = excluded.saved_at,
            project_summary_json = excluded.project_summary_json
        `).run(
          generation,
          operation.metadata.totalFiles,
          operation.metadata.totalChunks,
          operation.metadata.savedAt,
          operation.metadata.projectSummary ? JSON.stringify(operation.metadata.projectSummary) : null,
        )
      })
      return { type: 'ok' }
    }
    case 'clear':
      inTransaction(database, () => {
        database.exec('DELETE FROM files; DELETE FROM index_state;')
      })
      return { type: 'ok' }
    case 'close':
      database.exec('PRAGMA optimize')
      database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      database.close()
      databases.delete(operation.databasePath)
      return { type: 'ok' }
  }
}

let operationQueue = Promise.resolve()

parentPort?.on('message', (request: StructuralIndexStoreRequest) => {
  operationQueue = operationQueue.then(() => {
    let message: StructuralIndexStoreMessage
    try {
      const result = executeStructuralIndexStoreOperation(
        request.operation,
      )
      message = { type: 'response', requestId: request.requestId, ok: true, result }
    } catch (error) {
      message = {
        type: 'response',
        requestId: request.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
    parentPort?.postMessage(message)
  })
})
