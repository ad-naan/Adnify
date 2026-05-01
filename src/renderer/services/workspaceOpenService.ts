import { api } from '@/renderer/services/electronAPI'
import { workspaceManager, WorkspaceOpenError } from '@/renderer/services/WorkspaceManager'
import { logger } from '@utils/Logger'
import { toast } from '@components/common/ToastProvider'
import { getFileName } from '@shared/utils/pathUtils'
import { t, type Language } from '@renderer/i18n'

export async function openFolderFromDialog(language: Language): Promise<void> {
  const folderPath = await api.file.openFolder()
  if (!folderPath) return

  try {
    await workspaceManager.openFolder(folderPath)
  } catch (error) {
    logger.ui.error('[WorkspaceOpen] Failed to open folder:', error)
    if (error instanceof WorkspaceOpenError && error.code === 'missing-workspace') {
      toast.error(t('workspace.folderNotExist', language), getFileName(folderPath))
      return
    }
    toast.error(t('workspace.openFolderFailed', language))
  }
}

export async function openWorkspaceFromDialog(language: Language): Promise<void> {
  try {
    const result = await api.workspace.open()
    if (result && !('redirected' in result)) {
      await workspaceManager.switchTo(result)
    }
  } catch (error) {
    logger.ui.error('[WorkspaceOpen] Failed to open workspace:', error)
    toast.error(t('workspace.openWorkspaceFailed', language))
  }
}

export async function openRecentWorkspace(path: string, language: Language): Promise<void> {
  try {
    await workspaceManager.openFolder(path)
  } catch (error) {
    if (error instanceof WorkspaceOpenError && error.code === 'missing-workspace') {
      toast.error(t('workspace.folderNotExist', language), getFileName(path))
      return
    }

    logger.ui.error('[WorkspaceOpen] Failed to open recent workspace:', error)
    toast.error(t('workspace.openFolderFailed', language), getFileName(path))
  }
}

export async function openWorkspacePath(path: string, language: Language): Promise<void> {
  await openRecentWorkspace(path, language)
}
