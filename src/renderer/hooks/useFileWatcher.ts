import { useEffect } from 'react'
import { useStore } from '@store'
import { api } from '@renderer/services/electronAPI'
import { t, type Language } from '@renderer/i18n'
import { globalConfirm } from '@renderer/components/common/ConfirmDialog'
import { getFileName, pathEquals } from '@shared/utils/pathUtils'
import { removeFileFromTypeService } from '@renderer/services/monacoTypeService'
import { internalWriteTracker } from '@renderer/services/internalWriteTracker'

export function useFileWatcher() {
  useEffect(() => {
    const unsubscribe = api.file.onChanged(async (event: { event: string; path: string }) => {
      const { openFiles, reloadFileFromDisk, markFileDeleted, markFileRestored, language } = useStore.getState()

      if (event.event === 'delete') {
        removeFileFromTypeService(event.path)

        const openFile = openFiles.find((file) => pathEquals(file.path, event.path))
        if (openFile) {
          markFileDeleted(openFile.path)
        }
        return
      }

      if (event.event === 'create') {
        const openFile = openFiles.find((file) => pathEquals(file.path, event.path))
        if (openFile?.isDeleted) {
          const newContent = await api.file.read(event.path)
          if (newContent !== null) {
            reloadFileFromDisk(openFile.path, newContent)
          } else {
            markFileRestored(openFile.path)
          }
        }
        return
      }

      if (event.event !== 'update') return

      const openFile = openFiles.find((file) => pathEquals(file.path, event.path))
      if (!openFile) return

      const newContent = await api.file.read(event.path)
      if (newContent === null || newContent === openFile.content) return

      const isInternal = internalWriteTracker.consume(event.path)

      if (isInternal) {
        reloadFileFromDisk(openFile.path, newContent)
        return
      }

      if (openFile.isDirty) {
        const confirmed = await globalConfirm({
          title: getFileName(event.path),
          message: t('file.externalModifiedReload', language as Language, { name: getFileName(event.path) }),
          confirmText: language === 'zh' ? '重新加载' : 'Reload',
          cancelText: t('cancel', language as Language),
          variant: 'warning',
        })

        if (confirmed) {
          reloadFileFromDisk(openFile.path, newContent)
        }
        return
      }

      reloadFileFromDisk(openFile.path, newContent)
    })

    return unsubscribe
  }, [])
}
