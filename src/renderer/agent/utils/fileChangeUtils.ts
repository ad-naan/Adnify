import { getToolMetadata } from '@/shared/config/tools'
import { toRelativePath } from '@shared/utils/pathUtils'
import type { ChangeType, FileChangeDescriptor } from '../types/fileChange'

export interface FileChangeMetaLike {
  filePath: string
  relativePath?: unknown
  postHash?: unknown
  newContent?: unknown
  oldContent?: unknown
  linesAdded?: unknown
  linesRemoved?: unknown
}

export function isFileWriteToolResult(toolName: string, meta: unknown): meta is FileChangeMetaLike {
  if (!meta || typeof meta !== 'object') return false

  const tool = getToolMetadata(toolName)
  if (tool?.resultSemantics !== 'file-write') return false

  return typeof (meta as { filePath?: unknown }).filePath === 'string'
}

export function getRelativeChangePath(
  filePath: string,
  workspacePath: string | null,
  explicitRelativePath?: unknown
): string {
  if (typeof explicitRelativePath === 'string' && explicitRelativePath.trim().length > 0) {
    return explicitRelativePath
  }

  return toRelativePath(filePath, workspacePath)
}

export function buildFileChangeDescriptor(input: {
  filePath: string
  workspacePath?: string | null
  relativePath?: unknown
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
}): FileChangeDescriptor {
  return {
    filePath: input.filePath,
    relativePath: getRelativeChangePath(input.filePath, input.workspacePath ?? null, input.relativePath),
    oldContent: input.oldContent,
    newContent: input.newContent,
    changeType: input.changeType,
    linesAdded: input.linesAdded,
    linesRemoved: input.linesRemoved,
    isLargeWrite: input.isLargeWrite,
    contentTruncated: input.contentTruncated,
    oldContentLength: input.oldContentLength,
    newContentLength: input.newContentLength,
    toolCallId: input.toolCallId,
  }
}
