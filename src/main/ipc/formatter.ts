import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { securityManager } from '../security'
import { formatWithProjectTool } from '../services/formatterService'
import type { FormatDocumentRequest, FormatDocumentResult } from '@shared/types/formatter'

type WorkspaceSession = { roots: string[] } | null

export function registerFormatterHandlers(getWorkspaceSession: (event: IpcMainInvokeEvent) => WorkspaceSession): void {
  ipcMain.handle('formatter:formatDocument', async (event, request: FormatDocumentRequest): Promise<FormatDocumentResult> => {
    if (!request || typeof request.filePath !== 'string' || typeof request.content !== 'string') {
      return { status: 'error', message: 'Invalid format request' }
    }

    const workspace = getWorkspaceSession(event)
    const workspaceRoot = workspace?.roots
      .filter(root => securityManager.validateWorkspacePath(request.filePath, [root]))
      .sort((a, b) => b.length - a.length)[0]
    if (!workspaceRoot || securityManager.isSensitivePath(request.filePath)) {
      return { status: 'unavailable' }
    }

    return formatWithProjectTool(request.filePath, request.content, workspaceRoot)
  })
}
