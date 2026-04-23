import { joinPath } from '@shared/utils/pathUtils'
import { api } from '@/renderer/services/electronAPI'
import { streamingEditService } from './streamingEditService'
import { resolveEditFileRequest, type EditFileBatchEdit } from '@/shared/utils/editFile'

const STREAMABLE_EDIT_TOOL_NAMES = new Set(['edit_file'])

interface StreamingEditPreviewSession {
  filePath: string
  editId: string
  originalContent: string
}

function applyLineEditPreview(originalContent: string, startLine: number, endLine: number, content: string): string | null {
  const lines = originalContent.split('\n')
  if (startLine < 1 || endLine < startLine || endLine > lines.length) return null

  lines.splice(startLine - 1, endLine - startLine + 1, ...content.split('\n'))
  return lines.join('\n')
}

function applyBatchEditPreview(originalContent: string, edits: EditFileBatchEdit[]): string | null {
  let lines = originalContent.split('\n')
  const sortedEdits = [...edits].sort((a, b) => {
    const aLine = a.start_line ?? a.after_line ?? 0
    const bLine = b.start_line ?? b.after_line ?? 0
    return bLine - aLine
  })

  for (const edit of sortedEdits) {
    if (edit.action === 'replace') {
      if (
        typeof edit.start_line !== 'number' ||
        typeof edit.end_line !== 'number' ||
        typeof edit.content !== 'string' ||
        edit.start_line < 1 ||
        edit.end_line < edit.start_line ||
        edit.end_line > lines.length
      ) {
        return null
      }

      lines = [
        ...lines.slice(0, edit.start_line - 1),
        ...edit.content.split('\n'),
        ...lines.slice(edit.end_line),
      ]
      continue
    }

    if (edit.action === 'insert') {
      if (
        typeof edit.after_line !== 'number' ||
        typeof edit.content !== 'string' ||
        edit.after_line < 0 ||
        edit.after_line > lines.length
      ) {
        return null
      }

      lines = [
        ...lines.slice(0, edit.after_line),
        ...edit.content.split('\n'),
        ...lines.slice(edit.after_line),
      ]
      continue
    }

    if (
      typeof edit.start_line !== 'number' ||
      typeof edit.end_line !== 'number' ||
      edit.start_line < 1 ||
      edit.end_line < edit.start_line ||
      edit.end_line > lines.length
    ) {
      return null
    }

    lines = [
      ...lines.slice(0, edit.start_line - 1),
      ...lines.slice(edit.end_line),
    ]
  }

  return lines.join('\n')
}

export function resolveStreamingEditFilePath(path: unknown, workspacePath?: string | null): string | null {
  if (typeof path !== 'string' || path.length === 0) return null

  const isAbsolute = /^([a-zA-Z]:[\\/]|[/])/.test(path)
  if (isAbsolute || !workspacePath) return path

  return joinPath(workspacePath, path)
}

export function buildStreamingEditPreview(originalContent: string, args: Record<string, unknown>): string | null {
  const resolution = resolveEditFileRequest(args)
  if (!resolution.ok) return null

  if (resolution.mode === 'string') {
    const { old_string: oldString, new_string: newString, replace_all: replaceAll } = resolution.args
    if (!oldString || !originalContent.includes(oldString)) return null

    return replaceAll
      ? originalContent.split(oldString).join(newString)
      : originalContent.replace(oldString, newString)
  }

  if (resolution.mode === 'line') {
    return applyLineEditPreview(
      originalContent,
      resolution.args.start_line,
      resolution.args.end_line,
      resolution.args.content
    )
  }

  return applyBatchEditPreview(originalContent, resolution.args.edits)
}

export class StreamingEditPreviewCoordinator {
  private sessions = new Map<string, StreamingEditPreviewSession>()
  private pendingLoads = new Map<string, Promise<StreamingEditPreviewSession | null>>()

  async sync(toolId: string, toolName: string, partialArgs?: Record<string, unknown>, workspacePath?: string | null): Promise<void> {
    if (!partialArgs || !STREAMABLE_EDIT_TOOL_NAMES.has(toolName)) return

    const filePath = resolveStreamingEditFilePath(partialArgs.path, workspacePath)
    if (!filePath) return

    const session = await this.ensureSession(toolId, filePath)
    if (!session) return

    const previewContent = buildStreamingEditPreview(session.originalContent, {
      ...partialArgs,
      path: filePath,
    })
    if (previewContent === null) return

    streamingEditService.replaceContent(session.editId, previewContent)
  }

  release(toolId: string): void {
    const existing = this.sessions.get(toolId)
    if (!existing) return

    streamingEditService.cancelEdit(existing.editId)
    this.sessions.delete(toolId)
    this.pendingLoads.delete(toolId)
  }

  releaseAll(): void {
    for (const toolId of Array.from(this.sessions.keys())) {
      this.release(toolId)
    }
    this.pendingLoads.clear()
  }

  private async ensureSession(toolId: string, filePath: string): Promise<StreamingEditPreviewSession | null> {
    const existing = this.sessions.get(toolId)
    if (existing?.filePath === filePath) {
      return existing
    }

    if (existing && existing.filePath !== filePath) {
      streamingEditService.cancelEdit(existing.editId)
      this.sessions.delete(toolId)
    }

    const pending = this.pendingLoads.get(toolId)
    if (pending) {
      return pending
    }

    const loadPromise = (async () => {
      const originalContent = await api.file.read(filePath)
      if (originalContent === null) {
        return null
      }

      const editId = streamingEditService.startEdit(filePath, originalContent)
      const session = { filePath, editId, originalContent }
      this.sessions.set(toolId, session)
      return session
    })()

    this.pendingLoads.set(toolId, loadPromise)

    try {
      return await loadPromise
    } finally {
      this.pendingLoads.delete(toolId)
    }
  }
}
