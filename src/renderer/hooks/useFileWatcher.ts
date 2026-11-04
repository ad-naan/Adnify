import { useEffect } from 'react'
import { useStore } from '@store'
import { api } from '@renderer/services/electronAPI'
import { t, type Language } from '@shared/i18n'
import { globalConfirm } from '@renderer/components/common/ConfirmDialog'
import { getFileName, pathEquals } from '@shared/utils/pathUtils'
import { internalWriteTracker } from '@renderer/services/internalWriteTracker'
import { applySavedEditorBufferContent, getEditorBufferVersion } from '@renderer/services/editorBufferService'
import { logger } from '@utils/Logger'

export function useFileWatcher() {
  useEffect(() => {
    let disposed = false
    const pendingReads = new Map<string, symbol>()
    const readOpenFileContent = async (file: { path: string; kind?: string; largeFileView?: { chunkSize: number } }) => {
      if (file.kind === 'large-preview') {
        const chunk = await api.file.readTextChunk(file.path, 0, file.largeFileView?.chunkSize)
        return chunk?.content ?? null
      }
      return api.file.readFull(file.path)
    }

    const unsubscribe = api.file.onChanged(async (event: { event: string; path: string }) => {
      if (disposed || !['create', 'update', 'delete'].includes(event.event)) return
      const openFile = useStore.getState().openFiles.find(file => pathEquals(file.path, event.path))
      if (!openFile) return

      const request = Symbol()
      pendingReads.set(openFile.path, request)

      if (event.event === 'delete') {
        pendingReads.delete(openFile.path)
        useStore.getState().markFileDeleted(openFile.path)
        return
      }

      if (event.event === 'create' && !openFile.isDeleted) {
        pendingReads.delete(openFile.path)
        return
      }

      const isInternal = internalWriteTracker.consume(event.path)
      const versionBeforeRead = getEditorBufferVersion(openFile.path)
      const getCurrentFile = () => {
        if (disposed || pendingReads.get(openFile.path) !== request) return undefined
        const current = useStore.getState().openFiles.find(file => pathEquals(file.path, openFile.path))
        // A close/reopen or an explicit reload invalidates the outstanding read.
        return current?.contentLoadVersion === openFile.contentLoadVersion ? current : undefined
      }

      try {
        const newContent = await readOpenFileContent(openFile)
        const current = getCurrentFile()
        if (!current) return
        if (newContent === null) {
          if (event.event === 'create') useStore.getState().markFileRestored(current.path)
          return
        }
        if (newContent === current.content && !current.isDeleted) return

        const currentVersion = getEditorBufferVersion(current.path)
        const changedDuringRead = currentVersion !== versionBeforeRead || current.content !== openFile.content
          || current.isDirty !== openFile.isDirty || current.savedVersionId !== openFile.savedVersionId
        if (changedDuringRead || (current.isDirty && !isInternal)) {
          const { language } = useStore.getState()
          const confirmed = await globalConfirm({
            title: getFileName(event.path),
            message: t('file.externalModifiedReload', language as Language, { name: getFileName(event.path) }),
            confirmText: t('useFileWatcher.reload', language),
            cancelText: t('cancel', language as Language),
            variant: 'warning',
          })

          const latest = getCurrentFile()
          if (!confirmed || !latest || getEditorBufferVersion(latest.path) !== currentVersion
            || latest.content !== current.content || latest.isDirty !== current.isDirty
            || latest.savedVersionId !== current.savedVersionId) return
        }
        applySavedEditorBufferContent(current.path, newContent)
      } catch (error) {
        logger.ui.warn('[FileWatcher] Failed to reload changed file', { path: openFile.path, error })
      } finally {
        if (pendingReads.get(openFile.path) === request) pendingReads.delete(openFile.path)
      }
    })

    return () => {
      disposed = true
      pendingReads.clear()
      unsubscribe()
    }
  }, [])
}
