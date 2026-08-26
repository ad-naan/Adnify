import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'fs'
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
const LOAD_BATCH_SIZE = 50

function openDatabase(databasePath: string): DatabaseSync {
  const existing = databases.get(databasePath)
  if (existing) return existing

  mkdirSync(path.dirname(databasePath), { recursive: true })
  const database = new DatabaseSync(databasePath)
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS index_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      active_generation TEXT NOT NULL,
      total_files INTEGER NOT NULL CHECK (total_files >= 0),
      total_chunks INTEGER NOT NULL CHECK (total_chunks >= 0),
      saved_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS chunks (
      generation TEXT NOT NULL,
      id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (generation, id)
    ) WITHOUT ROWID, STRICT;

    CREATE INDEX IF NOT EXISTS chunks_generation_file
      ON chunks(generation, relative_path);
  `)
  // A terminated rebuild may leave an uncommitted generation behind. Only the
  // active generation is authoritative, so orphan rows are safe to remove.
  database.exec(`
    DELETE FROM chunks
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

function insertChunks(database: DatabaseSync, generation: string, chunks: CodeChunk[]): void {
  const insert = database.prepare(`
    INSERT OR REPLACE INTO chunks(generation, id, relative_path, payload_json)
    VALUES (?, ?, ?, ?)
  `)
  for (const chunk of chunks) {
    insert.run(generation, chunk.id, chunk.relativePath, JSON.stringify(chunk))
  }
}

function readMetadata(database: DatabaseSync): (StructuralIndexMetadata & { generation: string }) | null {
  const row = database.prepare(`
    SELECT active_generation, total_files, total_chunks, saved_at
    FROM index_state WHERE singleton = 1
  `).get() as {
    active_generation: string
    total_files: number
    total_chunks: number
    saved_at: number
  } | undefined
  return row ? {
    generation: row.active_generation,
    totalFiles: row.total_files,
    totalChunks: row.total_chunks,
    savedAt: row.saved_at,
  } : null
}

function loadPage(
  database: DatabaseSync,
  cursor?: StructuralIndexCursor,
): StructuralIndexStoreResult {
  const metadata = readMetadata(database)
  if (!metadata) {
    return { type: 'loadedPage', metadata: null, chunks: [], nextCursor: null }
  }

  const rows = cursor
    ? database.prepare(`
        SELECT id, relative_path, payload_json FROM chunks
        WHERE generation = ?
          AND (relative_path > ? OR (relative_path = ? AND id > ?))
        ORDER BY relative_path, id LIMIT ?
      `).all(
        metadata.generation,
        cursor.relativePath,
        cursor.relativePath,
        cursor.id,
        LOAD_BATCH_SIZE,
      ) as Array<{ id: string; relative_path: string; payload_json: string }>
    : database.prepare(`
        SELECT id, relative_path, payload_json FROM chunks
        WHERE generation = ? ORDER BY relative_path, id LIMIT ?
      `).all(metadata.generation, LOAD_BATCH_SIZE) as Array<{
        id: string
        relative_path: string
        payload_json: string
      }>
  const { generation: _generation, ...result } = metadata
  const last = rows.at(-1)
  return {
    type: 'loadedPage',
    metadata: result,
    chunks: rows.map(row => JSON.parse(row.payload_json) as CodeChunk),
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
      database.prepare('DELETE FROM chunks WHERE generation = ?').run(operation.generation)
      return { type: 'ok' }
    case 'appendReplace':
      inTransaction(database, () => insertChunks(database, operation.generation, operation.chunks))
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
          INSERT INTO index_state(singleton, active_generation, total_files, total_chunks, saved_at)
          VALUES (1, ?, ?, ?, ?)
          ON CONFLICT(singleton) DO UPDATE SET
            active_generation = excluded.active_generation,
            total_files = excluded.total_files,
            total_chunks = excluded.total_chunks,
            saved_at = excluded.saved_at
        `).run(
          operation.generation,
          operation.metadata.totalFiles,
          operation.metadata.totalChunks,
          operation.metadata.savedAt,
        )
        database.prepare('DELETE FROM chunks WHERE generation <> ?').run(operation.generation)
      })
      return { type: 'ok' }
    }
    case 'abortReplace':
      database.prepare('DELETE FROM chunks WHERE generation = ?').run(operation.generation)
      return { type: 'ok' }
    case 'applyFiles': {
      const current = readMetadata(database)
      const generation = current?.generation || `incremental-${operation.metadata.savedAt}`
      inTransaction(database, () => {
        const remove = database.prepare(
          'DELETE FROM chunks WHERE generation = ? AND relative_path = ?',
        )
        for (const file of operation.files) {
          remove.run(generation, file.relativePath)
          insertChunks(database, generation, file.chunks)
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
          INSERT INTO index_state(singleton, active_generation, total_files, total_chunks, saved_at)
          VALUES (1, ?, ?, ?, ?)
          ON CONFLICT(singleton) DO UPDATE SET
            total_files = excluded.total_files,
            total_chunks = excluded.total_chunks,
            saved_at = excluded.saved_at
        `).run(
          generation,
          operation.metadata.totalFiles,
          operation.metadata.totalChunks,
          operation.metadata.savedAt,
        )
      })
      return { type: 'ok' }
    }
    case 'clear':
      inTransaction(database, () => {
        database.exec('DELETE FROM chunks; DELETE FROM index_state;')
      })
      return { type: 'ok' }
    case 'close':
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
