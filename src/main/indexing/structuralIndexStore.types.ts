import type { CodeChunk, ProjectSummary } from './types'

export interface StructuralIndexMetadata {
  totalFiles: number
  totalChunks: number
  savedAt: number
  projectSummary?: ProjectSummary
}

export interface StructuralIndexCursor {
  relativePath: string
  id: string
}

export type StructuralIndexStoreOperation =
  | { type: 'loadPage'; databasePath: string; cursor?: StructuralIndexCursor }
  | { type: 'beginReplace'; databasePath: string; generation: string }
  | { type: 'appendReplace'; databasePath: string; generation: string; chunks: CodeChunk[] }
  | { type: 'commitReplace'; databasePath: string; generation: string; metadata: StructuralIndexMetadata }
  | { type: 'abortReplace'; databasePath: string; generation: string }
  | {
      type: 'applyFiles'
      databasePath: string
      files: Array<{ relativePath: string; chunks: CodeChunk[] }>
      metadata: StructuralIndexMetadata
    }
  | { type: 'clear'; databasePath: string }
  | { type: 'close'; databasePath: string }

export interface StructuralIndexStoreRequest {
  requestId: string
  operation: StructuralIndexStoreOperation
}

export type StructuralIndexStoreResult =
  | { type: 'ok' }
  | {
      type: 'loadedPage'
      metadata: StructuralIndexMetadata | null
      chunks: CodeChunk[]
      nextCursor: StructuralIndexCursor | null
    }

export type StructuralIndexStoreMessage =
  | { type: 'response'; requestId: string; ok: true; result: StructuralIndexStoreResult }
  | { type: 'response'; requestId: string; ok: false; error: string }
