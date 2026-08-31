import { useEffect } from 'react'
import { useStore } from '@store'
import { api } from '@renderer/services/electronAPI'
import { t, type Language, asLanguage } from '@renderer/i18n'
import { globalConfirm } from '@renderer/components/common/ConfirmDialog'
import { getFileName, pathEquals } from '@shared/utils/pathUtils'
import { internalWriteTracker } from '@renderer/services/internalWriteTracker'
import { applySavedEditorBufferContent } from '@renderer/services/editorBufferService'

export function useFileWatcher() {
  useEffect(() => {
    const readOpenFileContent = async (file: { path: string; kind?: string; largeFileView?: { chunkSize: number } }) => {
      if (file.kind === 'large-preview') {
        const chunk = await api.file.readTextChunk(file.path, 0, file.largeFileView?.chunkSize)
        return chunk?.content ?? null
      }
      return api.file.readFull(file.path)
    }

    const unsubscribe = api.file.onChanged(async (event: { event: string; path: string }) => {
      const { openFiles, markFileDeleted, markFileRestored, language } = useStore.getState()

      if (event.event === 'delete') {
        const openFile = openFiles.find((file) => pathEquals(file.path, event.path))
        if (openFile) {
          markFileDeleted(openFile.path)
        }
        return
      }

      if (event.event === 'create') {
        const openFile = openFiles.find((file) => pathEquals(file.path, event.path))
        if (openFile?.isDeleted) {
          const newContent = await readOpenFileContent(openFile)
          if (newContent !== null) {
            applySavedEditorBufferContent(openFile.path, newContent)
          } else {
            markFileRestored(openFile.path)
          }
        }
        return
      }

      if (event.event !== 'update') return

      const openFile = openFiles.find((file) => pathEquals(file.path, event.path))
      if (!openFile) return

      const newContent = await readOpenFileContent(openFile)
      if (newContent === null || newContent === openFile.content) return

      const isInternal = internalWriteTracker.consume(event.path)

      if (isInternal) {
        applySavedEditorBufferContent(openFile.path, newContent)
        return
      }

      if (openFile.isDirty) {
        const confirmed = await globalConfirm({
          title: getFileName(event.path),
          message: t('file.externalModifiedReload', language as Language, { name: getFileName(event.path) }),
          confirmText: t('useFileWatcher.reload', asLanguage(language)),
          cancelText: t('cancel', language as Language),
          variant: 'warning',
        })

        if (confirmed) {
          applySavedEditorBufferContent(openFile.path, newContent)
        }
        return
      }

      applySavedEditorBufferContent(openFile.path, newContent)
    })

    return unsubscribe
  }, [])
}
