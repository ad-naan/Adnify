import { createHash, randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import * as path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { parentPort } from 'worker_threads'
import { serveUtility } from '../process/utilityServer'
import type { SessionWorkerOperation } from '@shared/types/sessionPersistence'
import type {
  SessionBranchMetadata,
  SessionBranchPatch,
  SessionCatalogRecord,
  SessionMessageWrite,
  SessionPatch,
  SessionStateRecord,
  SessionStorageStats,
  SessionThreadMetadata,
  SessionWorkerRequest,
  SessionWorkerResponse,
  SessionWorkerResult,
} from '@shared/types/sessionPersistence'
import { PLAN_HISTORY_WINDOW } from '@shared/constants'

interface OpenDatabase {
  database: DatabaseSync
  path: string
  writesSinceCheckpoint: number
  dirtySinceBackup: boolean
  idleCheckpoint: ReturnType<typeof setTimeout> | null
  protectedBackupBlobHashes: Set<string> | null
}

interface BlobDescriptor {
  hash: string
  encoding: 'utf8' | 'base64'
  byteLength: number
}

interface PreparedMessage extends Omit<SessionMessageWrite, 'payload'> {
  payloadJson: string
  blobs: BlobDescriptor[]
}

interface PreparedBranch extends Omit<SessionBranchPatch, 'messages'> {
  messages: PreparedMessage[]
}

interface BlobReference {
  __adnifyBlob: 1
  hash: string
  encoding: BlobDescriptor['encoding']
}

const databases = new Map<string, OpenDatabase>()
const DEFAULT_STATE: SessionStateRecord = {
  currentThreadId: null,
  activeBranchId: {},
  version: 0,
}
const LATEST_SCHEMA_VERSION = 5
const BLOB_THRESHOLD_BYTES = 256 * 1024
const IDLE_CHECKPOINT_MS = 30_000
const CHECKPOINT_WRITE_THRESHOLD = 32
const BACKUP_MIN_INTERVAL_MS = 24 * 60 * 60 * 1_000
const INTEGRITY_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000

function configure(database: DatabaseSync): void {
  database.exec(`
    PRAGMA page_size = 8192;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA wal_autocheckpoint = 0;
    PRAGMA journal_size_limit = 16777216;
    PRAGMA temp_store = MEMORY;
    PRAGMA cache_size = -32768;
    PRAGMA mmap_size = 268435456;
    PRAGMA trusted_schema = OFF;
  `)
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table))
}

function migrateV1(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS migration_log (
      name TEXT PRIMARY KEY,
      completed_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS session_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      last_modified INTEGER NOT NULL,
      title TEXT,
      message_count INTEGER NOT NULL CHECK (message_count >= 0),
      metadata_json TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS messages (
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      message_id TEXT NOT NULL,
      role TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (thread_id, ordinal)
    ) WITHOUT ROWID, STRICT;

    CREATE INDEX IF NOT EXISTS messages_thread_id_id
      ON messages(thread_id, message_id);
  `)
}

function migrateV2(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS branches (
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      branch_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      name TEXT NOT NULL,
      fork_from_message_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
      message_count INTEGER NOT NULL CHECK (message_count >= 0),
      metadata_json TEXT NOT NULL,
      PRIMARY KEY (thread_id, branch_id)
    ) WITHOUT ROWID, STRICT;

    CREATE INDEX IF NOT EXISTS branches_thread_ordinal
      ON branches(thread_id, ordinal);

    CREATE TABLE IF NOT EXISTS branch_messages (
      thread_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      message_id TEXT NOT NULL,
      role TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (thread_id, branch_id, ordinal),
      FOREIGN KEY (thread_id, branch_id)
        REFERENCES branches(thread_id, branch_id) ON DELETE CASCADE
    ) WITHOUT ROWID, STRICT;
  `)

  const row = database.prepare('SELECT payload FROM session_state WHERE singleton = 1').get() as
    | { payload: string }
    | undefined
  if (!row) return

  const legacyState = JSON.parse(row.payload) as SessionStateRecord & {
    branches?: Record<string, unknown>
  }
  const legacyBranches = legacyState.branches || {}
  const insertBranch = database.prepare(`
    INSERT OR IGNORE INTO branches(
      thread_id, branch_id, ordinal, name, fork_from_message_id,
      created_at, is_active, message_count, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertMessage = database.prepare(`
    INSERT OR IGNORE INTO branch_messages(
      thread_id, branch_id, ordinal, message_id, role, timestamp, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  for (const [threadId, value] of Object.entries(legacyBranches)) {
    if (!Array.isArray(value) || !database.prepare('SELECT 1 FROM threads WHERE id = ?').get(threadId)) continue
    value.forEach((rawBranch, branchOrdinal) => {
      if (!rawBranch || typeof rawBranch !== 'object') return
      const branch = rawBranch as Record<string, unknown>
      const id = typeof branch.id === 'string' ? branch.id : `${threadId}:${branchOrdinal}`
      const messages = Array.isArray(branch.messages) ? branch.messages : []
      const { messages: _messages, ...metadata } = branch
      insertBranch.run(
        threadId,
        id,
        branchOrdinal,
        typeof branch.name === 'string' ? branch.name : id,
        typeof branch.forkFromMessageId === 'string' ? branch.forkFromMessageId : '',
        typeof branch.createdAt === 'number' ? branch.createdAt : 0,
        branch.isActive === true ? 1 : 0,
        messages.length,
        JSON.stringify(metadata),
      )
      messages.forEach((payload, ordinal) => {
        const message = payload && typeof payload === 'object'
          ? payload as Record<string, unknown>
          : {}
        insertMessage.run(
          threadId,
          id,
          ordinal,
          typeof message.id === 'string' ? message.id : `${id}:${ordinal}`,
          typeof message.role === 'string' ? message.role : 'unknown',
          typeof message.timestamp === 'number' ? message.timestamp : 0,
          JSON.stringify(payload),
        )
      })
    })
  }

  const { branches: _branches, ...state } = legacyState
  database.prepare('UPDATE session_state SET payload = ?, updated_at = ? WHERE singleton = 1')
    .run(JSON.stringify(state), Date.now())
  if (tableExists(database, 'schema_info')) database.exec('DROP TABLE schema_info')
}

function migrateV3(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS blobs (
      hash TEXT PRIMARY KEY,
      encoding TEXT NOT NULL CHECK (encoding IN ('utf8', 'base64')),
      byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
      ref_count INTEGER NOT NULL CHECK (ref_count >= 0),
      created_at INTEGER NOT NULL
    ) STRICT;
  `)
}

function migrateV4(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      updated_at INTEGER NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 0),
      payload_json TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS plans_updated_at ON plans(updated_at DESC);
  `)
}

function migrateV5(database: DatabaseSync): void {
  if (tableExists(database, 'message_blobs') && tableExists(database, 'branch_message_blobs')) {
    database.exec(`
      CREATE INDEX IF NOT EXISTS threads_last_modified_id
        ON threads(last_modified DESC, id ASC);
      DROP INDEX IF EXISTS plans_updated_at;
      CREATE INDEX IF NOT EXISTS plans_updated_at_id
        ON plans(updated_at DESC, id ASC);
      DROP INDEX IF EXISTS messages_thread_id_id;
      CREATE TABLE IF NOT EXISTS maintenance_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        last_quick_check_at INTEGER NOT NULL,
        clean_shutdown INTEGER NOT NULL CHECK (clean_shutdown IN (0, 1))
      ) STRICT;
      INSERT OR IGNORE INTO maintenance_state(singleton, last_quick_check_at, clean_shutdown)
        VALUES (1, 0, 1);
    `)
    return
  }

  database.exec(`
    CREATE INDEX IF NOT EXISTS threads_last_modified_id
      ON threads(last_modified DESC, id ASC);

    DROP INDEX IF EXISTS plans_updated_at;
    DROP INDEX IF EXISTS messages_thread_id_id;
    CREATE INDEX IF NOT EXISTS plans_updated_at_id
      ON plans(updated_at DESC, id ASC);

    CREATE TABLE blobs_v5 (
      hash TEXT PRIMARY KEY,
      encoding TEXT NOT NULL CHECK (encoding IN ('utf8', 'base64')),
      byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
      created_at INTEGER NOT NULL
    ) STRICT;

    INSERT INTO blobs_v5(hash, encoding, byte_length, created_at)
      SELECT hash, encoding, byte_length, created_at FROM blobs;

    CREATE TABLE message_blobs (
      thread_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      hash TEXT NOT NULL REFERENCES blobs_v5(hash) ON DELETE RESTRICT,
      PRIMARY KEY (thread_id, ordinal, hash),
      FOREIGN KEY (thread_id, ordinal)
        REFERENCES messages(thread_id, ordinal) ON DELETE CASCADE
    ) WITHOUT ROWID, STRICT;

    CREATE INDEX message_blobs_hash ON message_blobs(hash);

    CREATE TABLE branch_message_blobs (
      thread_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      hash TEXT NOT NULL REFERENCES blobs_v5(hash) ON DELETE RESTRICT,
      PRIMARY KEY (thread_id, branch_id, ordinal, hash),
      FOREIGN KEY (thread_id, branch_id, ordinal)
        REFERENCES branch_messages(thread_id, branch_id, ordinal) ON DELETE CASCADE
    ) WITHOUT ROWID, STRICT;

    CREATE INDEX branch_message_blobs_hash ON branch_message_blobs(hash);

    CREATE TABLE IF NOT EXISTS maintenance_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      last_quick_check_at INTEGER NOT NULL,
      clean_shutdown INTEGER NOT NULL CHECK (clean_shutdown IN (0, 1))
    ) STRICT;

    INSERT OR IGNORE INTO maintenance_state(singleton, last_quick_check_at, clean_shutdown)
      VALUES (1, 0, 1);
  `)

  const insertMessageBlob = database.prepare(`
    INSERT OR IGNORE INTO message_blobs(thread_id, ordinal, hash) VALUES (?, ?, ?)
  `)
  const insertBranchMessageBlob = database.prepare(`
    INSERT OR IGNORE INTO branch_message_blobs(thread_id, branch_id, ordinal, hash)
    VALUES (?, ?, ?, ?)
  `)
  const messages = database.prepare(
    'SELECT thread_id, ordinal, payload_json FROM messages',
  ).all() as Array<{ thread_id: string; ordinal: number; payload_json: string }>
  for (const row of messages) {
    for (const reference of blobReferences(row.payload_json)) {
      insertMessageBlob.run(row.thread_id, row.ordinal, reference.hash)
    }
  }
  const branchMessages = database.prepare(
    'SELECT thread_id, branch_id, ordinal, payload_json FROM branch_messages',
  ).all() as Array<{
    thread_id: string
    branch_id: string
    ordinal: number
    payload_json: string
  }>
  for (const row of branchMessages) {
    for (const reference of blobReferences(row.payload_json)) {
      insertBranchMessageBlob.run(row.thread_id, row.branch_id, row.ordinal, reference.hash)
    }
  }

  database.exec(`
    DROP TABLE blobs;
    ALTER TABLE blobs_v5 RENAME TO blobs;
  `)
}

function migrateSchema(database: DatabaseSync): boolean {
  let version = Number((database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
  if (version > LATEST_SCHEMA_VERSION) {
    throw new Error(`Session database schema ${version} is newer than supported ${LATEST_SCHEMA_VERSION}`)
  }

  const startingVersion = version
  const migrations = [migrateV1, migrateV2, migrateV3, migrateV4, migrateV5]
  while (version < LATEST_SCHEMA_VERSION) {
    const nextVersion = version + 1
    database.exec('BEGIN IMMEDIATE')
    try {
      migrations[nextVersion - 1](database)
      database.exec(`PRAGMA user_version = ${nextVersion}`)
      database.exec('COMMIT')
      version = nextVersion
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  return version !== startingVersion
}

function assertHealthy(database: DatabaseSync): void {
  const result = database.prepare('PRAGMA quick_check(1)').get() as Record<string, unknown> | undefined
  if (!result || !Object.values(result).includes('ok')) {
    throw new Error(`Session database integrity check failed: ${JSON.stringify(result)}`)
  }
}

function openConfiguredDatabase(databasePath: string): DatabaseSync {
  const database = new DatabaseSync(databasePath)
  try {
    configure(database)
    return database
  } catch (error) {
    try { database.close() } catch { /* preserve original failure */ }
    throw error
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function syncFile(filePath: string): Promise<void> {
  const handle = await fs.open(filePath, 'r+')
  try { await handle.sync() } finally { await handle.close() }
}

async function syncDirectory(directoryPath: string): Promise<void> {
  // Directory fsync is supported on POSIX. Windows durably flushes the renamed
  // file handle, but does not allow opening directories through this API.
  if (process.platform === 'win32') return
  const handle = await fs.open(directoryPath, 'r')
  try { await handle.sync() } finally { await handle.close() }
}

function assertBackupHealthy(backupPath: string): void {
  const database = new DatabaseSync(backupPath, { readOnly: true })
  try { assertHealthy(database) } finally { database.close() }
}

async function recoverFromBackup(databasePath: string, openError: unknown): Promise<DatabaseSync> {
  const candidates = [`${databasePath}.bak`, `${databasePath}.bak.previous`]
  let backupPath: string | undefined
  for (const candidate of candidates) {
    if (!await fileExists(candidate)) continue
    try {
      assertBackupHealthy(candidate)
      backupPath = candidate
      break
    } catch { /* try the older verified snapshot */ }
  }
  if (!backupPath) throw openError

  const suffix = `.corrupt-${Date.now()}`
  for (const source of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (await fileExists(source)) await fs.rename(source, `${source}${suffix}`)
  }
  await fs.copyFile(backupPath, databasePath)
  return openConfiguredDatabase(databasePath)
}

async function openHealthyDatabase(databasePath: string): Promise<{ database: DatabaseSync; migrated: boolean }> {
  let database: DatabaseSync | undefined
  let checkedAt = 0
  try {
    database = openConfiguredDatabase(databasePath)
    const maintenance = tableExists(database, 'maintenance_state')
      ? database.prepare(`
          SELECT last_quick_check_at, clean_shutdown
          FROM maintenance_state WHERE singleton = 1
        `).get() as { last_quick_check_at: number; clean_shutdown: number } | undefined
      : undefined
    const now = Date.now()
    if (!maintenance || maintenance.clean_shutdown !== 1 ||
      now - maintenance.last_quick_check_at >= INTEGRITY_CHECK_INTERVAL_MS) {
      assertHealthy(database)
      checkedAt = now
    }
  } catch (error) {
    try { database?.close() } catch { /* recovery owns the next connection */ }
    database = await recoverFromBackup(databasePath, error)
    checkedAt = Date.now()
  }

  if (!database) throw new Error('Session database failed to open')
  try {
    if (!tableExists(database, 'threads')) database.exec('PRAGMA auto_vacuum = INCREMENTAL')
    const schemaMigrated = migrateSchema(database)
    const payloadsMigrated = await externalizeLegacyPayloads(database, databasePath)
    database.prepare(`
      UPDATE maintenance_state
      SET last_quick_check_at = CASE WHEN ? > 0 THEN ? ELSE last_quick_check_at END,
          clean_shutdown = 0
      WHERE singleton = 1
    `).run(checkedAt, checkedAt)
    return { database, migrated: schemaMigrated || payloadsMigrated }
  } catch (error) {
    database.close()
    // A failed or unsupported migration is not database corruption. Keep the
    // primary untouched (the migration transaction rolled back) and surface it.
    throw error
  }
}

async function getDatabase(databasePath: string): Promise<OpenDatabase> {
  const existing = databases.get(databasePath)
  if (existing) return existing
  await fs.mkdir(path.dirname(databasePath), { recursive: true })
  const initialized = await openHealthyDatabase(databasePath)
  const opened: OpenDatabase = {
    database: initialized.database,
    path: databasePath,
    writesSinceCheckpoint: 0,
    dirtySinceBackup: initialized.migrated,
    idleCheckpoint: null,
    protectedBackupBlobHashes: null,
  }
  databases.set(databasePath, opened)
  return opened
}

function blobDirectory(databasePath: string): string {
  return `${databasePath}.blobs`
}

function blobPath(databasePath: string, hash: string): string {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid session blob hash')
  return path.join(blobDirectory(databasePath), hash.slice(0, 2), hash)
}

async function writeBlob(
  databasePath: string,
  bytes: Buffer,
  createdHashes: Set<string>,
): Promise<string> {
  const hash = createHash('sha256').update(bytes).digest('hex')
  const target = blobPath(databasePath, hash)
  if (await fileExists(target)) return hash

  await fs.mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.${randomUUID()}.tmp`
  const handle = await fs.open(temporary, 'wx')
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await fs.rename(temporary, target)
    await syncDirectory(path.dirname(target))
    createdHashes.add(hash)
  } catch (error) {
    await fs.rm(temporary, { force: true })
    if (!await fileExists(target)) throw error
  }
  return hash
}

function isBlobReference(value: unknown): value is BlobReference {
  return Boolean(
    value && typeof value === 'object' &&
    (value as BlobReference).__adnifyBlob === 1 &&
    typeof (value as BlobReference).hash === 'string',
  )
}

async function externalizeValue(
  value: unknown,
  databasePath: string,
  blobs: BlobDescriptor[],
  createdHashes: Set<string>,
  key?: string,
  parent?: Record<string, unknown>,
): Promise<unknown> {
  if (typeof value === 'string') {
    const isBase64 = key === 'base64' || (key === 'data' && parent?.type === 'base64')
    const bytes = isBase64 ? Buffer.from(value, 'base64') : Buffer.from(value, 'utf8')
    if (bytes.byteLength < BLOB_THRESHOLD_BYTES) return value
    const descriptor: BlobDescriptor = {
      hash: await writeBlob(databasePath, bytes, createdHashes),
      encoding: isBase64 ? 'base64' : 'utf8',
      byteLength: bytes.byteLength,
    }
    blobs.push(descriptor)
    return { __adnifyBlob: 1, hash: descriptor.hash, encoding: descriptor.encoding } satisfies BlobReference
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map(item => externalizeValue(item, databasePath, blobs, createdHashes)))
  }
  if (!value || typeof value !== 'object') return value

  const record = value as Record<string, unknown>
  const entries = await Promise.all(Object.entries(record).map(async ([childKey, child]) => [
    childKey,
    await externalizeValue(child, databasePath, blobs, createdHashes, childKey, record),
  ] as const))
  return Object.fromEntries(entries)
}

async function prepareMessage(
  databasePath: string,
  message: SessionMessageWrite,
  createdHashes: Set<string>,
): Promise<PreparedMessage> {
  // Preserve JSON.stringify semantics (including rejecting BigInt) before any transaction begins.
  const compatible = JSON.parse(JSON.stringify(message.payload)) as unknown
  const blobs: BlobDescriptor[] = []
  const externalized = await externalizeValue(compatible, databasePath, blobs, createdHashes)
  return {
    ordinal: message.ordinal,
    id: message.id,
    role: message.role,
    timestamp: message.timestamp,
    payloadJson: JSON.stringify(externalized),
    blobs,
  }
}

async function externalizeLegacyPayloads(database: DatabaseSync, databasePath: string): Promise<boolean> {
  const migrationName = 'externalize-large-payloads-v1'
  if (database.prepare('SELECT 1 FROM migration_log WHERE name = ?').get(migrationName)) return false

  const messageRows = database.prepare(
    'SELECT thread_id, ordinal, payload_json FROM messages',
  ).all() as Array<{ thread_id: string; ordinal: number; payload_json: string }>
  const branchRows = database.prepare(
    'SELECT thread_id, branch_id, ordinal, payload_json FROM branch_messages',
  ).all() as Array<{ thread_id: string; branch_id: string; ordinal: number; payload_json: string }>
  const preparedMessages: Array<typeof messageRows[number] & { nextJson: string; blobs: BlobDescriptor[] }> = []
  const preparedBranches: Array<typeof branchRows[number] & { nextJson: string; blobs: BlobDescriptor[] }> = []
  const createdHashes = new Set<string>()

  try {
    for (const row of messageRows) {
      const blobs: BlobDescriptor[] = []
      const nextJson = JSON.stringify(await externalizeValue(
        JSON.parse(row.payload_json), databasePath, blobs, createdHashes,
      ))
      if (blobs.length > 0) preparedMessages.push({ ...row, nextJson, blobs })
    }
    for (const row of branchRows) {
      const blobs: BlobDescriptor[] = []
      const nextJson = JSON.stringify(await externalizeValue(
        JSON.parse(row.payload_json), databasePath, blobs, createdHashes,
      ))
      if (blobs.length > 0) preparedBranches.push({ ...row, nextJson, blobs })
    }
  } catch (error) {
    await removeUnreferencedCreatedBlobs(database, databasePath, createdHashes)
    throw error
  }

  database.exec('BEGIN IMMEDIATE')
  try {
    const blobStatements = createBlobStatements(database)
    const updateMessage = database.prepare(
      'UPDATE messages SET payload_json = ? WHERE thread_id = ? AND ordinal = ?',
    )
    const updateBranch = database.prepare(
      'UPDATE branch_messages SET payload_json = ? WHERE thread_id = ? AND branch_id = ? AND ordinal = ?',
    )
    for (const row of preparedMessages) {
      updateMessage.run(row.nextJson, row.thread_id, row.ordinal)
      insertBlobReferences(blobStatements, {
        type: 'message', threadId: row.thread_id, ordinal: row.ordinal,
      }, row.blobs)
    }
    for (const row of preparedBranches) {
      updateBranch.run(row.nextJson, row.thread_id, row.branch_id, row.ordinal)
      insertBlobReferences(blobStatements, {
        type: 'branchMessage', threadId: row.thread_id,
        branchId: row.branch_id, ordinal: row.ordinal,
      }, row.blobs)
    }
    database.prepare('INSERT INTO migration_log(name, completed_at) VALUES (?, ?)')
      .run(migrationName, Date.now())
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    await removeUnreferencedCreatedBlobs(database, databasePath, createdHashes)
    throw error
  }
  return true
}

async function hydrateValue(value: unknown, databasePath: string): Promise<unknown> {
  if (isBlobReference(value)) {
    const bytes = await fs.readFile(blobPath(databasePath, value.hash))
    return value.encoding === 'base64' ? bytes.toString('base64') : bytes.toString('utf8')
  }
  if (Array.isArray(value)) return Promise.all(value.map(item => hydrateValue(item, databasePath)))
  if (!value || typeof value !== 'object') return value
  const entries = await Promise.all(Object.entries(value as Record<string, unknown>).map(async ([key, child]) => [
    key,
    await hydrateValue(child, databasePath),
  ] as const))
  return Object.fromEntries(entries)
}

function blobReferences(payloadJson: string): BlobReference[] {
  const found: BlobReference[] = []
  const visit = (value: unknown): void => {
    if (isBlobReference(value)) {
      found.push(value)
      return
    }
    if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  visit(JSON.parse(payloadJson))
  return found
}

function createBlobStatements(database: DatabaseSync) {
  return {
    insertBlob: database.prepare(`
      INSERT OR IGNORE INTO blobs(hash, encoding, byte_length, created_at)
      VALUES (?, ?, ?, ?)
    `),
    insertMessageBlob: database.prepare(`
      INSERT OR IGNORE INTO message_blobs(thread_id, ordinal, hash) VALUES (?, ?, ?)
    `),
    insertBranchMessageBlob: database.prepare(`
      INSERT OR IGNORE INTO branch_message_blobs(thread_id, branch_id, ordinal, hash)
      VALUES (?, ?, ?, ?)
    `),
  }
}

type BlobOwner =
  | { type: 'message'; threadId: string; ordinal: number }
  | { type: 'branchMessage'; threadId: string; branchId: string; ordinal: number }

function insertBlobReferences(
  statements: ReturnType<typeof createBlobStatements>,
  owner: BlobOwner,
  blobs: BlobDescriptor[],
): void {
  const inserted = new Set<string>()
  for (const blob of blobs) {
    if (inserted.has(blob.hash)) continue
    inserted.add(blob.hash)
    statements.insertBlob.run(blob.hash, blob.encoding, blob.byteLength, Date.now())
    if (owner.type === 'message') {
      statements.insertMessageBlob.run(owner.threadId, owner.ordinal, blob.hash)
    } else {
      statements.insertBranchMessageBlob.run(
        owner.threadId, owner.branchId, owner.ordinal, blob.hash,
      )
    }
  }
}

async function removeUnreferencedCreatedBlobs(
  database: DatabaseSync,
  databasePath: string,
  createdHashes: Set<string>,
): Promise<void> {
  if (createdHashes.size === 0) return
  const isTracked = database.prepare('SELECT 1 FROM blobs WHERE hash = ?')
  await Promise.all([...createdHashes].map(async hash => {
    if (isTracked.get(hash)) return
    await fs.rm(blobPath(databasePath, hash), { force: true }).catch(() => undefined)
  }))
}

function readBackupBlobHashes(backup: DatabaseSync): Set<string> {
  const hashes = new Set<string>()
  if (tableExists(backup, 'message_blobs') && tableExists(backup, 'branch_message_blobs')) {
    const rows = backup.prepare(`
      SELECT hash FROM message_blobs
      UNION
      SELECT hash FROM branch_message_blobs
    `).all() as Array<{ hash: string }>
    for (const row of rows) hashes.add(row.hash)
    return hashes
  }

  // A pre-v5 recovery snapshot can survive the first application upgrade.
  // Parse it once per worker lifetime, then the next snapshot rotation removes
  // this compatibility path from the hot commit loop.
  for (const table of ['messages', 'branch_messages'] as const) {
    if (!tableExists(backup, table)) continue
    const rows = backup.prepare(`SELECT payload_json FROM ${table}`).all() as Array<{ payload_json: string }>
    for (const row of rows) {
      for (const reference of blobReferences(row.payload_json)) hashes.add(reference.hash)
    }
  }
  return hashes
}

async function protectedBackupBlobHashes(opened: OpenDatabase): Promise<Set<string> | null> {
  if (opened.protectedBackupBlobHashes) return opened.protectedBackupBlobHashes
  const protectedHashes = new Set<string>()
  for (const backupPath of [`${opened.path}.bak`, `${opened.path}.bak.previous`]) {
    if (!await fileExists(backupPath)) continue
    let backup: DatabaseSync | undefined
    try {
      backup = new DatabaseSync(backupPath, { readOnly: true })
      assertHealthy(backup)
      for (const hash of readBackupBlobHashes(backup)) protectedHashes.add(hash)
    } catch {
      // Fail closed: an unreadable snapshot must never cause companion data loss.
      return null
    } finally {
      backup?.close()
    }
  }
  opened.protectedBackupBlobHashes = protectedHashes
  return protectedHashes
}

async function collectGarbageBlobs(opened: OpenDatabase): Promise<void> {
  const rows = opened.database.prepare(`
    SELECT b.hash
    FROM blobs b
    WHERE NOT EXISTS (SELECT 1 FROM message_blobs m WHERE m.hash = b.hash)
      AND NOT EXISTS (SELECT 1 FROM branch_message_blobs bm WHERE bm.hash = b.hash)
  `).all() as Array<{ hash: string }>
  if (rows.length === 0) return

  const protectedHashes = await protectedBackupBlobHashes(opened)
  if (!protectedHashes) return
  const removeRow = opened.database.prepare(`
    DELETE FROM blobs
    WHERE hash = ?
      AND NOT EXISTS (SELECT 1 FROM message_blobs m WHERE m.hash = blobs.hash)
      AND NOT EXISTS (SELECT 1 FROM branch_message_blobs bm WHERE bm.hash = blobs.hash)
  `)
  for (const row of rows) {
    if (protectedHashes.has(row.hash)) continue
    try {
      await fs.rm(blobPath(opened.path, row.hash), { force: true })
      removeRow.run(row.hash)
    } catch { /* retry during the next maintenance cycle */ }
  }
}

function readState(database: DatabaseSync): SessionStateRecord {
  const row = database.prepare('SELECT payload FROM session_state WHERE singleton = 1').get() as
    | { payload: string }
    | undefined
  if (!row) return { ...DEFAULT_STATE }
  const parsed = JSON.parse(row.payload) as Partial<SessionStateRecord>
  return {
    currentThreadId: typeof parsed.currentThreadId === 'string' ? parsed.currentThreadId : null,
    activeBranchId: parsed.activeBranchId && typeof parsed.activeBranchId === 'object'
      ? parsed.activeBranchId
      : {},
    version: typeof parsed.version === 'number' ? parsed.version : 0,
  }
}

function readThreads(database: DatabaseSync): SessionThreadMetadata[] {
  const rows = database.prepare(`
    SELECT id, created_at, last_modified, title, message_count, metadata_json
    FROM threads ORDER BY last_modified DESC, id ASC
  `).all() as Array<{
    id: string
    created_at: number
    last_modified: number
    title: string | null
    message_count: number
    metadata_json: string
  }>
  return rows.map(row => ({
    id: row.id,
    createdAt: row.created_at,
    lastModified: row.last_modified,
    title: row.title ?? undefined,
    messageCount: row.message_count,
    data: JSON.parse(row.metadata_json) as Record<string, unknown>,
  }))
}

function readBranches(database: DatabaseSync): SessionBranchMetadata[] {
  const rows = database.prepare(`
    SELECT thread_id, branch_id, ordinal, name, fork_from_message_id,
           created_at, is_active, message_count, metadata_json
    FROM branches ORDER BY thread_id, ordinal
  `).all() as Array<{
    thread_id: string
    branch_id: string
    ordinal: number
    name: string
    fork_from_message_id: string
    created_at: number
    is_active: number
    message_count: number
    metadata_json: string
  }>
  return rows.map(row => ({
    threadId: row.thread_id,
    id: row.branch_id,
    ordinal: row.ordinal,
    name: row.name,
    forkFromMessageId: row.fork_from_message_id,
    createdAt: row.created_at,
    isActive: row.is_active === 1,
    messageCount: row.message_count,
    data: JSON.parse(row.metadata_json) as Record<string, unknown>,
  }))
}

function readCatalog(database: DatabaseSync): SessionCatalogRecord {
  return { state: readState(database), threads: readThreads(database), branches: readBranches(database) }
}

async function readMessages(database: DatabaseSync, databasePath: string, threadId: string): Promise<unknown[]> {
  const rows = database.prepare(`
    SELECT payload_json FROM messages WHERE thread_id = ? ORDER BY ordinal
  `).all(threadId) as Array<{ payload_json: string }>
  return Promise.all(rows.map(row => hydrateValue(JSON.parse(row.payload_json), databasePath)))
}

async function readBranchMessages(
  database: DatabaseSync,
  databasePath: string,
  threadId: string,
): Promise<Array<{ id: string; messages: unknown[] }>> {
  const branches = database.prepare(
    'SELECT branch_id FROM branches WHERE thread_id = ? ORDER BY ordinal',
  ).all(threadId) as Array<{ branch_id: string }>
  const rows = database.prepare(`
    SELECT branch_id, payload_json FROM branch_messages
    WHERE thread_id = ? ORDER BY branch_id, ordinal
  `).all(threadId) as Array<{ branch_id: string; payload_json: string }>
  const payloadsByBranch = new Map<string, string[]>()
  for (const row of rows) {
    const payloads = payloadsByBranch.get(row.branch_id) || []
    if (!payloadsByBranch.has(row.branch_id)) payloadsByBranch.set(row.branch_id, payloads)
    payloads.push(row.payload_json)
  }
  return Promise.all(branches.map(async branch => ({
    id: branch.branch_id,
    messages: await Promise.all((payloadsByBranch.get(branch.branch_id) || [])
      .map(payload => hydrateValue(JSON.parse(payload), databasePath))),
  })))
}

function upsertThread(database: DatabaseSync, thread: SessionThreadMetadata): void {
  database.prepare(`
    INSERT INTO threads(id, created_at, last_modified, title, message_count, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      created_at = excluded.created_at,
      last_modified = excluded.last_modified,
      title = excluded.title,
      message_count = excluded.message_count,
      metadata_json = excluded.metadata_json
  `).run(
    thread.id,
    thread.createdAt,
    thread.lastModified,
    thread.title ?? null,
    thread.messageCount,
    JSON.stringify(thread.data),
  )
}

function insertMessages(
  database: DatabaseSync,
  table: 'messages' | 'branch_messages',
  threadId: string,
  messages: PreparedMessage[],
  branchId?: string,
): void {
  if (table === 'branch_messages' && !branchId) {
    throw new Error('branchId is required for branch messages')
  }
  const messageBranchId = branchId ?? ''
  const blobStatements = createBlobStatements(database)
  const insert = table === 'messages'
    ? database.prepare(`
        INSERT INTO messages(thread_id, ordinal, message_id, role, timestamp, payload_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
    : database.prepare(`
        INSERT INTO branch_messages(
          thread_id, branch_id, ordinal, message_id, role, timestamp, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
  for (const message of messages) {
    if (table === 'messages') {
      insert.run(threadId, message.ordinal, message.id, message.role, message.timestamp, message.payloadJson)
      insertBlobReferences(blobStatements, {
        type: 'message', threadId, ordinal: message.ordinal,
      }, message.blobs)
    } else {
      insert.run(threadId, messageBranchId, message.ordinal, message.id, message.role, message.timestamp, message.payloadJson)
      insertBlobReferences(blobStatements, {
        type: 'branchMessage', threadId, branchId: messageBranchId, ordinal: message.ordinal,
      }, message.blobs)
    }
  }
}

async function applyPatch(opened: OpenDatabase, patch: SessionPatch): Promise<void> {
  const { database, path: databasePath } = opened
  const createdHashes = new Set<string>()
  let preparedThreads: Array<Omit<SessionPatch['threads'][number], 'messages'> & {
    messages: PreparedMessage[]
  }>
  let preparedBranchThreads: Array<{ threadId: string; branches: PreparedBranch[] }>
  try {
    preparedThreads = await Promise.all(patch.threads.map(async thread => ({
      ...thread,
      messages: await Promise.all((thread.messages || [])
        .map(message => prepareMessage(databasePath, message, createdHashes))),
    })))
    preparedBranchThreads = await Promise.all(patch.branchThreads.map(async entry => ({
      threadId: entry.threadId,
      branches: await Promise.all(entry.branches.map(async branch => ({
        ...branch,
        messages: await Promise.all(branch.messages
          .map(message => prepareMessage(databasePath, message, createdHashes))),
      } satisfies PreparedBranch))),
    })))
  } catch (error) {
    await removeUnreferencedCreatedBlobs(database, databasePath, createdHashes)
    throw error
  }

  database.exec('BEGIN IMMEDIATE')
  try {
    const deleteThread = database.prepare('DELETE FROM threads WHERE id = ?')
    for (const threadId of patch.deletedThreadIds) {
      deleteThread.run(threadId)
    }

    for (const threadPatch of preparedThreads) {
      upsertThread(database, threadPatch.metadata)
      if (threadPatch.replaceFrom !== undefined) {
        database.prepare('DELETE FROM messages WHERE thread_id = ? AND ordinal >= ?')
          .run(threadPatch.metadata.id, threadPatch.replaceFrom)
        insertMessages(database, 'messages', threadPatch.metadata.id, threadPatch.messages)
      }
    }

    const deleteBranches = database.prepare('DELETE FROM branches WHERE thread_id = ?')
    const insertBranch = database.prepare(`
      INSERT INTO branches(
        thread_id, branch_id, ordinal, name, fork_from_message_id,
        created_at, is_active, message_count, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const entry of preparedBranchThreads) {
      deleteBranches.run(entry.threadId)
      for (const branch of entry.branches) {
        insertBranch.run(
          branch.threadId,
          branch.id,
          branch.ordinal,
          branch.name,
          branch.forkFromMessageId,
          branch.createdAt,
          branch.isActive ? 1 : 0,
          branch.messageCount,
          JSON.stringify(branch.data),
        )
        insertMessages(database, 'branch_messages', branch.threadId, branch.messages, branch.id)
      }
    }

    if (patch.state) {
      database.prepare(`
        INSERT INTO session_state(singleton, payload, updated_at) VALUES (1, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
      `).run(JSON.stringify(patch.state), Date.now())
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    await removeUnreferencedCreatedBlobs(database, databasePath, createdHashes)
    throw error
  }
  const mayHaveOrphanedBlobs = patch.deletedThreadIds.length > 0 ||
    patch.branchThreads.length > 0 || patch.threads.some(thread => thread.replaceFrom !== undefined)
  if (mayHaveOrphanedBlobs) await collectGarbageBlobs(opened)
}

async function importLegacy(database: DatabaseSync, databasePath: string, sessionsDir: string): Promise<boolean> {
  const migrationName = 'workspace-jsonl-v1'
  if (database.prepare('SELECT 1 FROM migration_log WHERE name = ?').get(migrationName)) return false
  const markComplete = (): void => {
    database.prepare('INSERT OR IGNORE INTO migration_log(name, completed_at) VALUES (?, ?)')
      .run(migrationName, Date.now())
  }
  const existing = database.prepare('SELECT COUNT(*) AS count FROM threads').get() as { count: number }
  if (existing.count > 0) {
    markComplete()
    return false
  }

  let entries
  try {
    entries = await fs.readdir(sessionsDir, { withFileTypes: true })
  } catch {
    markComplete()
    return false
  }
  const metadataFiles = entries.filter(entry =>
    entry.isFile() && entry.name.endsWith('.json') && !entry.name.startsWith('_'))
  if (metadataFiles.length === 0) {
    markComplete()
    return false
  }

  let state = { ...DEFAULT_STATE }
  let legacyBranches: Record<string, unknown> = {}
  try {
    const meta = JSON.parse(await fs.readFile(path.join(sessionsDir, '_meta.json'), 'utf8')) as Partial<SessionStateRecord>
    let extra: Record<string, unknown> = {}
    try { extra = JSON.parse(await fs.readFile(path.join(sessionsDir, '_extra.json'), 'utf8')) } catch { /* optional */ }
    state = {
      currentThreadId: typeof meta.currentThreadId === 'string' ? meta.currentThreadId : null,
      activeBranchId: extra.activeBranchId && typeof extra.activeBranchId === 'object'
        ? extra.activeBranchId as Record<string, unknown>
        : {},
      version: typeof meta.version === 'number' ? meta.version : 0,
    }
    legacyBranches = extra.branches && typeof extra.branches === 'object'
      ? extra.branches as Record<string, unknown>
      : {}
  } catch { /* catalog can be rebuilt */ }

  const threads: SessionPatch['threads'] = []
  for (const entry of metadataFiles) {
    const raw = JSON.parse(await fs.readFile(path.join(sessionsDir, entry.name), 'utf8')) as Record<string, unknown>
    const id = typeof raw.id === 'string' ? raw.id : entry.name.slice(0, -5)
    const messages: unknown[] = []
    try {
      const content = await fs.readFile(path.join(sessionsDir, `${id}.jsonl`), 'utf8')
      for (const line of content.split(/\r?\n/)) if (line.trim()) messages.push(JSON.parse(line))
    } catch (error) {
      const missing = error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
      if (!missing && Number(raw.messageCount || 0) > 0) throw error
    }
    const { messages: _messages, ...data } = raw
    threads.push({
      metadata: {
        id,
        createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
        lastModified: typeof raw.lastModified === 'number' ? raw.lastModified : Date.now(),
        title: typeof raw.title === 'string' ? raw.title : undefined,
        messageCount: messages.length,
        data,
      },
      replaceFrom: 0,
      messages: messages.map((payload, ordinal) => {
        const message = payload as Record<string, unknown>
        return {
          ordinal,
          id: typeof message.id === 'string' ? message.id : `${id}:${ordinal}`,
          role: typeof message.role === 'string' ? message.role : 'unknown',
          timestamp: typeof message.timestamp === 'number' ? message.timestamp : 0,
          payload,
        }
      }),
    })
  }

  const branchThreads = Object.entries(legacyBranches).flatMap(([threadId, value]) => {
    if (!Array.isArray(value)) return []
    return [{
      threadId,
      branches: value.flatMap((raw, ordinal): SessionBranchPatch[] => {
        if (!raw || typeof raw !== 'object') return []
        const branch = raw as Record<string, unknown>
        const messages = Array.isArray(branch.messages) ? branch.messages : []
        const { messages: _messages, ...data } = branch
        const id = typeof branch.id === 'string' ? branch.id : `${threadId}:${ordinal}`
        return [{
          threadId,
          id,
          ordinal,
          name: typeof branch.name === 'string' ? branch.name : id,
          forkFromMessageId: typeof branch.forkFromMessageId === 'string' ? branch.forkFromMessageId : '',
          createdAt: typeof branch.createdAt === 'number' ? branch.createdAt : 0,
          isActive: branch.isActive === true,
          messageCount: messages.length,
          data,
          messages: messages.map((payload, messageOrdinal) => {
            const message = payload as Record<string, unknown>
            return {
              ordinal: messageOrdinal,
              id: typeof message.id === 'string' ? message.id : `${id}:${messageOrdinal}`,
              role: typeof message.role === 'string' ? message.role : 'unknown',
              timestamp: typeof message.timestamp === 'number' ? message.timestamp : 0,
              payload,
            }
          }),
        }]
      }),
    }]
  })

  const opened = databases.get(databasePath)
  if (!opened) throw new Error('Session database is not registered')
  await applyPatch(opened, { state, threads, deletedThreadIds: [], branchThreads })
  markComplete()
  return true
}

interface PersistedPlanRecord extends Record<string, unknown> {
  id: string
  name: string
  tasks: unknown[]
}

function planRecord(value: unknown): PersistedPlanRecord | null {
  if (!value || typeof value !== 'object') return null
  const plan = value as Record<string, unknown>
  return typeof plan.id === 'string' && plan.id.length > 0 &&
    typeof plan.name === 'string' && Array.isArray(plan.tasks)
    ? plan as PersistedPlanRecord
    : null
}

function writePlan(database: DatabaseSync, value: unknown): void {
  const plan = planRecord(value)
  if (!plan) throw new Error('Invalid task plan')
  const updatedAt = typeof plan.updatedAt === 'number' ? plan.updatedAt : Date.now()
  const revision = typeof plan.revision === 'number' && plan.revision >= 0 ? plan.revision : 0
  database.prepare(`
    INSERT INTO plans(id, updated_at, revision, payload_json)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      updated_at = excluded.updated_at,
      revision = excluded.revision,
      payload_json = excluded.payload_json
    WHERE excluded.revision >= plans.revision
  `).run(plan.id, updatedAt, revision, JSON.stringify(plan))
}

function readPlans(database: DatabaseSync): unknown[] {
  const rows = database.prepare(
    'SELECT payload_json FROM plans ORDER BY updated_at DESC, id ASC LIMIT ?',
  ).all(PLAN_HISTORY_WINDOW) as Array<{ payload_json: string }>
  return rows.map(row => JSON.parse(row.payload_json))
}

async function importLegacyPlans(database: DatabaseSync, planDir: string): Promise<boolean> {
  const migrationName = 'workspace-plan-json-v1'
  if (database.prepare('SELECT 1 FROM migration_log WHERE name = ?').get(migrationName)) return false

  let entries
  try {
    entries = await fs.readdir(planDir, { withFileTypes: true })
  } catch {
    database.prepare('INSERT INTO migration_log(name, completed_at) VALUES (?, ?)')
      .run(migrationName, Date.now())
    return false
  }

  const imported: unknown[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    try {
      const value = JSON.parse(await fs.readFile(path.join(planDir, entry.name), 'utf8'))
      if (planRecord(value)) imported.push(value)
    } catch { /* malformed legacy plan remains untouched */ }
  }

  database.exec('BEGIN IMMEDIATE')
  try {
    for (const plan of imported) writePlan(database, plan)
    database.prepare('INSERT INTO migration_log(name, completed_at) VALUES (?, ?)')
      .run(migrationName, Date.now())
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  return imported.length > 0
}

function checkpoint(opened: OpenDatabase, truncate: boolean): void {
  opened.database.exec(`PRAGMA wal_checkpoint(${truncate ? 'TRUNCATE' : 'PASSIVE'})`)
  opened.writesSinceCheckpoint = 0
}

function scheduleCheckpoint(opened: OpenDatabase): void {
  opened.writesSinceCheckpoint += 1
  opened.dirtySinceBackup = true
  if (opened.idleCheckpoint) clearTimeout(opened.idleCheckpoint)
  const delay = opened.writesSinceCheckpoint >= CHECKPOINT_WRITE_THRESHOLD ? 0 : IDLE_CHECKPOINT_MS
  opened.idleCheckpoint = setTimeout(() => {
    opened.idleCheckpoint = null
    try {
      checkpoint(opened, false)
      const pageCount = Number(
        (opened.database.prepare('PRAGMA page_count').get() as { page_count: number }).page_count,
      )
      const freePages = Number(
        (opened.database.prepare('PRAGMA freelist_count').get() as { freelist_count: number }).freelist_count,
      )
      // Reclaim only meaningful fragmentation. Running incremental_vacuum on
      // every quiet period creates needless SSD writes for normal append-only use.
      if (freePages >= 1024 && freePages / Math.max(1, pageCount) >= 0.2) {
        opened.database.exec(`PRAGMA incremental_vacuum(${Math.min(256, freePages)})`)
      }
      opened.database.exec('PRAGMA optimize')
    } catch { /* retry on next idle/close */ }
  }, delay)
}

async function closeAll(): Promise<void> {
  for (const opened of databases.values()) {
    if (opened.idleCheckpoint) clearTimeout(opened.idleCheckpoint)
    try {
      opened.database.prepare(
        'UPDATE maintenance_state SET clean_shutdown = 1 WHERE singleton = 1',
      ).run()
    } catch { /* an older failed migration remains recoverable */ }
    try { checkpoint(opened, true) } catch { /* WAL remains recoverable */ }
    opened.database.close()
    try {
      const backupPath = `${opened.path}.bak`
      const age = await fs.stat(backupPath)
        .then(stat => Date.now() - stat.mtimeMs)
        .catch(() => Number.POSITIVE_INFINITY)
      if (!opened.dirtySinceBackup || age < BACKUP_MIN_INTERVAL_MS) continue
      const previous = `${backupPath}.previous`
      const temporary = `${backupPath}.tmp`
      await fs.rm(temporary, { force: true })
      await fs.copyFile(opened.path, temporary)
      await syncFile(temporary)
      assertBackupHealthy(temporary)
      await fs.rm(previous, { force: true })
      if (await fileExists(backupPath)) await fs.rename(backupPath, previous)
      await fs.rename(temporary, backupPath)
      await syncDirectory(path.dirname(backupPath))
    } catch { /* committed primary remains authoritative */ }
  }
  databases.clear()
}

async function clearDatabase(opened: OpenDatabase): Promise<void> {
  opened.database.exec('BEGIN IMMEDIATE')
  try {
    opened.database.exec(`
      DELETE FROM branch_messages;
      DELETE FROM branches;
      DELETE FROM messages;
      DELETE FROM threads;
      DELETE FROM session_state;
      DELETE FROM blobs;
    `)
    opened.database.exec('COMMIT')
  } catch (error) {
    opened.database.exec('ROLLBACK')
    throw error
  }
  // Clear is an explicit destructive operation: old recovery points must not
  // resurrect the deleted conversation on the next corruption recovery.
  await fs.rm(`${opened.path}.bak`, { force: true })
  await fs.rm(`${opened.path}.bak.previous`, { force: true })
  await fs.rm(blobDirectory(opened.path), { recursive: true, force: true })
  opened.protectedBackupBlobHashes = new Set()
}

async function readStats(database: DatabaseSync, databasePath: string): Promise<SessionStorageStats> {
  const scalar = (sql: string, key: string): number => Number(
    (database.prepare(sql).get() as Record<string, unknown> | undefined)?.[key] || 0,
  )
  const fileBytes = async (target: string): Promise<number> => fs.stat(target)
    .then(stat => stat.size)
    .catch(() => 0)
  return {
    databaseBytes: await fileBytes(databasePath),
    walBytes: await fileBytes(`${databasePath}-wal`),
    blobBytes: scalar('SELECT COALESCE(SUM(byte_length), 0) AS value FROM blobs', 'value'),
    threadCount: scalar('SELECT COUNT(*) AS value FROM threads', 'value'),
    messageCount: scalar('SELECT COUNT(*) AS value FROM messages', 'value'),
    branchCount: scalar('SELECT COUNT(*) AS value FROM branches', 'value'),
    blobCount: scalar('SELECT COUNT(*) AS value FROM blobs', 'value'),
    planCount: scalar('SELECT COUNT(*) AS value FROM plans', 'value'),
    pageSize: scalar('PRAGMA page_size', 'page_size'),
    freePages: scalar('PRAGMA freelist_count', 'freelist_count'),
  }
}

export async function executeSessionStorageOperation(
  operation: SessionWorkerRequest['operation'],
): Promise<SessionWorkerResult> {
  if (operation.type === 'closeAll') {
    await closeAll()
    return { type: 'ok' }
  }
  const opened = await getDatabase(operation.databasePath)
  switch (operation.type) {
    case 'open': {
      const sessionsMigrated = operation.legacySessionsDir
        ? await importLegacy(opened.database, opened.path, operation.legacySessionsDir)
        : false
      const plansMigrated = operation.legacyPlanDir
        ? await importLegacyPlans(opened.database, operation.legacyPlanDir)
        : false
      const migrated = sessionsMigrated || plansMigrated
      if (migrated) opened.dirtySinceBackup = true
      return { type: 'opened', catalog: readCatalog(opened.database), migrated }
    }
    case 'loadCatalog':
      return { type: 'catalog', catalog: readCatalog(opened.database) }
    case 'loadMessages':
      return { type: 'messages', messages: await readMessages(opened.database, opened.path, operation.threadId) }
    case 'loadBranchMessages':
      return {
        type: 'branchMessages',
        branches: await readBranchMessages(opened.database, opened.path, operation.threadId),
      }
    case 'getStats':
      return { type: 'stats', stats: await readStats(opened.database, opened.path) }
    case 'loadPlans':
      return { type: 'plans', plans: readPlans(opened.database) }
    case 'upsertPlan':
      writePlan(opened.database, operation.plan)
      scheduleCheckpoint(opened)
      return { type: 'ok' }
    case 'deletePlan':
      opened.database.prepare('DELETE FROM plans WHERE id = ?').run(operation.planId)
      scheduleCheckpoint(opened)
      return { type: 'ok' }
    case 'applyPatch':
      await applyPatch(opened, operation.patch)
      scheduleCheckpoint(opened)
      return { type: 'ok' }
    case 'clear':
      await clearDatabase(opened)
      scheduleCheckpoint(opened)
      return { type: 'ok' }
    case 'checkpoint':
      checkpoint(opened, operation.truncate === true)
      return { type: 'ok' }
  }
}

const operationQueues = new Map<string, Promise<void>>()

async function respond(request: SessionWorkerRequest): Promise<void> {
  let response: SessionWorkerResponse
  try {
    response = {
      requestId: request.requestId,
      ok: true,
      result: await enqueueOperation(request.operation),
    }
  } catch (error) {
    response = {
      requestId: request.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
  parentPort?.postMessage(response)
}

function enqueueOperation(operation: SessionWorkerOperation): Promise<SessionWorkerResult> {
  if (operation.type === 'closeAll') {
    return Promise.allSettled([...operationQueues.values()]).then(() => executeSessionStorageOperation(operation))
  }
  const previous = operationQueues.get(operation.databasePath) || Promise.resolve()
  const result = previous.catch(() => {}).then(() => executeSessionStorageOperation(operation))
  const settled = result.then(() => {}, () => {})
  operationQueues.set(operation.databasePath, settled)
  void settled.then(() => {
    if (operationQueues.get(operation.databasePath) === settled) operationQueues.delete(operation.databasePath)
  })
  return result
}

if (process.parentPort) serveUtility(raw => enqueueOperation(raw as SessionWorkerOperation))

parentPort?.on('message', (request: SessionWorkerRequest) => {
  void respond(request)
})
