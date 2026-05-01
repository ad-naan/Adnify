import { useEffect, useRef } from 'react'
import { api } from '@renderer/services/electronAPI'
import { safeOpenFiles } from '@renderer/utils/fileUtils'
import { useStore } from '@store'
import { workspaceManager } from '@renderer/services/WorkspaceManager'

export function useOpenFilesFromSystem() {
  const language = useStore((state) => state.language || 'en')
  const readyRef = useRef(false)

  useEffect(() => {
    if (readyRef.current) return
    readyRef.current = true

    return api.app.onOpenFiles(async ({ items }) => {
      if (!items.length) return

      const workspaceItem = items.find((item) => item.kind === 'workspace' && item.roots?.length)
      if (workspaceItem?.roots?.length) {
        await workspaceManager.switchTo({
          configPath: workspaceItem.path,
          roots: workspaceItem.roots,
        })
        return
      }

      const folderItem = items.find((item) => item.kind === 'folder')
      if (folderItem) {
        await workspaceManager.openFolder(folderItem.path)
        return
      }

      const filePaths = items.filter((item) => item.kind === 'file').map((item) => item.path)
      if (filePaths.length > 0) {
        await safeOpenFiles(filePaths, {
          language,
          showWarning: false,
          confirmLargeFile: false,
        })
      }
    })
  }, [language])
}
