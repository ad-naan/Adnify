export interface SessionThreadMetadata {
  id: string
  createdAt: number
  lastModified: number
  title?: string
  messageCount: number
  data: Record<string, unknown>
}

export interface SessionMessageWrite {
  ordinal: number
  id: string
  role: string
  timestamp: number
  payload: unknown
}

export interface SessionThreadPatch {
  metadata: SessionThreadMetadata
  /** Replace the message tail beginning at this ordinal. Omit for metadata-only updates. */
  replaceFrom?: number
  messages?: SessionMessageWrite[]
}

export interface SessionStateRecord {
  currentThreadId: string | null
  activeBranchId: Record<string, unknown>
  version: number
}

export interface SessionBranchMetadata {
  threadId: string
  id: string
  ordinal: number
  name: string
  forkFromMessageId: string
  createdAt: number
  isActive: boolean
  messageCount: number
  data: Record<string, unknown>
}

export interface SessionBranchPatch extends SessionBranchMetadata {
  messages: SessionMessageWrite[]
}

export interface SessionBranchThreadPatch {
  threadId: string
  branches: SessionBranchPatch[]
}

export interface SessionPatch {
  /** Omit when navigation/branch state did not change. */
  state?: SessionStateRecord
  threads: SessionThreadPatch[]
  deletedThreadIds: string[]
  /** Complete replacement for each listed thread's branch set. */
  branchThreads: SessionBranchThreadPatch[]
}

export interface SessionCatalogRecord {
  state: SessionStateRecord
  threads: SessionThreadMetadata[]
  branches: SessionBranchMetadata[]
}

export interface SessionStorageStats {
  databaseBytes: number
  walBytes: number
  blobBytes: number
  threadCount: number
  messageCount: number
  branchCount: number
  blobCount: number
  pageSize: number
  freePages: number
}

export type SessionWorkerOperation =
  | { type: 'open'; databasePath: string; legacySessionsDir?: string }
  | { type: 'loadCatalog'; databasePath: string }
  | { type: 'loadMessages'; databasePath: string; threadId: string }
  | { type: 'loadBranchMessages'; databasePath: string; threadId: string }
  | { type: 'getStats'; databasePath: string }
  | { type: 'applyPatch'; databasePath: string; patch: SessionPatch }
  | { type: 'clear'; databasePath: string }
  | { type: 'checkpoint'; databasePath: string; truncate?: boolean }
  | { type: 'closeAll' }

export interface SessionWorkerRequest {
  requestId: string
  operation: SessionWorkerOperation
}

export type SessionWorkerResult =
  | { type: 'opened'; catalog: SessionCatalogRecord; migrated: boolean }
  | { type: 'catalog'; catalog: SessionCatalogRecord }
  | { type: 'messages'; messages: unknown[] }
  | { type: 'branchMessages'; branches: Array<{ id: string; messages: unknown[] }> }
  | { type: 'stats'; stats: SessionStorageStats }
  | { type: 'ok' }

export type SessionWorkerResponse =
  | { requestId: string; ok: true; result: SessionWorkerResult }
  | { requestId: string; ok: false; error: string }
