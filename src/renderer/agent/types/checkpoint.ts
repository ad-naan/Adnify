/**
 * Checkpoint and file snapshot types.
 */

import type { ContextItem } from './context'
import type { FileChangeDescriptor } from './fileChange'

export interface FileSnapshot {
  path: string
  content: string | null
  timestamp?: number
}

export interface CheckpointImage {
  id: string
  mimeType: string
  base64: string
}

export interface PendingChange extends Omit<FileChangeDescriptor, 'oldContent'> {
  id: string
  toolCallId: string
  toolName: string
  status: 'pending' | 'accepted' | 'rejected'
  snapshot: FileSnapshot
  timestamp: number
}

export interface MessageCheckpoint {
  id: string
  messageId: string
  timestamp: number
  fileSnapshots: Record<string, FileSnapshot>
  description: string
  images?: CheckpointImage[]
  contextItems?: ContextItem[]
}

export interface Checkpoint {
  id: string
  type: 'user_message' | 'tool_edit'
  timestamp: number
  snapshots: Record<string, FileSnapshot>
  description: string
  messageId?: string
}
