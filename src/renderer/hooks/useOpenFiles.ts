import { useEffect, useRef } from 'react'
import { api } from '@renderer/services/electronAPI'
import { safeOpenFiles } from '@renderer/utils/fileUtils'
import { useStore } from '@store'
import { workspaceManager } from '@renderer/services/WorkspaceManager'

/**
 * 获取文件所在的目录
 */
function getFileDirectory(filePath: string): string {
  const sepIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return sepIndex > 0 ? filePath.substring(0, sepIndex) : filePath
}

export function useOpenFilesFromSystem() {
  const language = useStore((state) => state.language || 'en')
  const readyRef = useRef(false)

  useEffect(() => {
    if (readyRef.current) return
    readyRef.current = true

    return api.app.onOpenFiles(async ({ items }) => {
      if (!items.length) return

      // 1. 工作区文件 → 切换工作区
      const workspaceItem = items.find((item) => item.kind === 'workspace' && item.roots?.length)
      if (workspaceItem?.roots?.length) {
        await workspaceManager.switchTo({
          configPath: workspaceItem.path,
          roots: workspaceItem.roots,
        })
        return
      }

      // 2. 文件夹 → 打开为工作区
      const folderItem = items.find((item) => item.kind === 'folder')
      if (folderItem) {
        await workspaceManager.openFolder(folderItem.path)
        return
      }

      // 3. 文件 → 直接打开（主进程已对文件关联路径授权）
      const filePaths = items.filter((item) => item.kind === 'file').map((item) => item.path)
      if (filePaths.length === 0) return

      const workspace = useStore.getState().workspace
      const hasWorkspace = workspace && workspace.roots.length > 0

      if (!hasWorkspace) {
        // 没有工作区 → 以第一个文件所在目录为工作区，提供完整的编辑体验
        const targetDir = getFileDirectory(filePaths[0])
        await workspaceManager.switchTo({
          configPath: null,
          roots: [targetDir],
        })
      }

      // 打开文件（文件关联路径已在主进程中被授权，不受工作区边界限制）
      await safeOpenFiles(filePaths, {
        language,
        showWarning: false,
        confirmLargeFile: false,
      })
    })
  }, [language])
}
