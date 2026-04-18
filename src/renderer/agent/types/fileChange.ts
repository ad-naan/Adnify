export type ChangeType = 'create' | 'modify' | 'delete'

export interface FileChangeDescriptor {
  filePath: string
  relativePath: string
  oldContent: string | null
  newContent: string | null
  changeType: ChangeType
  linesAdded: number
  linesRemoved: number
  isLargeWrite?: boolean
  contentTruncated?: boolean
  oldContentLength?: number
  newContentLength?: number
  toolCallId?: string
}

export type FileChangeStatus = 'pending' | 'accepted' | 'rejected'

export interface FileChangeRecord extends FileChangeDescriptor {
  status: FileChangeStatus
}
