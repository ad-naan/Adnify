/**
 * 文件保存相关 Hook
 * 统一处理保存、自动保存、关闭确认等逻辑
 */
import { useCallback, useRef, useEffect } from 'react'
import { useStore } from '@store'
import { api } from '@renderer/services/electronAPI'
import { getFileName } from '@shared/utils/pathUtils'
import { globalConfirm } from '@renderer/components/common/ConfirmDialog'
import { toast } from '@renderer/components/common/ToastProvider'
import { t } from '@shared/i18n'
import { getEditorConfig } from '@renderer/settings'
import { monaco } from '@renderer/monacoWorker'
import type { FileMutationResult } from '@shared/types/fileMutation'
import { commitEditorBufferSnapshot, getEditorBufferContent, isWritableDocumentKind } from '@renderer/services/editorBufferService'

function getSaveErrorMessage(result: FileMutationResult, language: 'zh' | 'en'): string {
  if (result.success) return ''
  const messages = language === 'zh'
    ? {
        permission_denied: '系统拒绝写入此文件',
        policy_denied: '安全策略不允许写入此路径',
        invalid_request: '保存请求无效',
        not_found: '文件或父目录不存在',
        locked: '文件正被其他程序占用',
        disk_full: '磁盘空间不足',
        io_error: '发生文件系统错误',
      }
    : {
        permission_denied: 'The system denied writing to this file',
        policy_denied: 'Security policy does not allow writing to this path',
        invalid_request: 'The save request is invalid',
        not_found: 'The file or parent directory does not exist',
        locked: 'The file is being used by another program',
        disk_full: 'The disk is full',
        io_error: 'A file system error occurred',
      }
  return result.error.message || messages[result.error.code]
}

/** 获取文件对应的 Monaco model 版本号 */
function getModelVersionId(filePath: string): number | undefined {
  const uri = monaco.Uri.file(filePath)
  const model = monaco.editor.getModel(uri)
  return model?.getAlternativeVersionId()
}

export function useFileSave() {
  const markFileSaved = useStore(state => state.markFileSaved)
  const closeFile = useStore(state => state.closeFile)
  const language = useStore(state => state.language)

  // 保存单个文件
  const saveFile = useCallback(async (filePath: string): Promise<boolean> => {
    const file = useStore.getState().openFiles.find(f => f.path === filePath)
    if (!file || file.pinned) return false
    if (!isWritableDocumentKind(file.kind)) return false

    try {
      const content = getEditorBufferContent(file.path, file.content)
      const result = await api.file.writeDetailed(file.path, content, file.encoding)
      if (result.success) {
        commitEditorBufferSnapshot(file.path, content)
        // 获取当前版本号并保存
        const versionId = getModelVersionId(file.path)
        markFileSaved(file.path, versionId)
        // 如果文件之前被删除，现在已恢复
        if (file.isDeleted) {
          const { markFileRestored } = useStore.getState()
          markFileRestored(file.path)
        }
        toast.success(
          t('common.fileSaved', language),
          getFileName(file.path)
        )
      } else {
        toast.error(
          t('common.saveFailed', language),
          getSaveErrorMessage(result, language)
        )
      }
      return result.success
    } catch (error) {
      toast.error(
        t('common.saveFailed', language),
        String(error)
      )
      return false
    }
  }, [markFileSaved, language])

  // 关闭文件（带保存提示）
  const closeFileWithConfirm = useCallback(async (filePath: string) => {
    const file = useStore.getState().openFiles.find(f => f.path === filePath)
    if (file?.pinned) return
    if (file?.isDirty) {
      const fileName = getFileName(filePath)
      const result = await globalConfirm({
        title: t('useFileSave.unsavedChanges', language),
        message: t('confirmUnsavedChanges', language, { name: fileName }),
        confirmText: t('saveSession', language),
        cancelText: t('useFileSave.donTSave', language),
        variant: 'warning',
      })
      if (result) {
        await saveFile(filePath)
      }
    }
    closeFile(filePath)
  }, [closeFile, saveFile, language])

  // 关闭其他文件
  const closeOtherFiles = useCallback(async (keepPath: string) => {
    const openFiles = useStore.getState().openFiles
    for (const file of openFiles) {
      if (file.path !== keepPath) {
        await closeFileWithConfirm(file.path)
      }
    }
  }, [closeFileWithConfirm])

  // 关闭所有文件
  const closeAllFiles = useCallback(async () => {
    const openFiles = useStore.getState().openFiles
    for (const file of [...openFiles]) {
      await closeFileWithConfirm(file.path)
    }
  }, [closeFileWithConfirm])

  // 关闭所有已保存文件，保留未保存的编辑内容
  const closeSavedFiles = useCallback(() => {
    const openFiles = useStore.getState().openFiles
    for (const file of openFiles) {
      if (!file.isDirty) {
        closeFile(file.path)
      }
    }
  }, [closeFile])

  // 关闭右侧文件
  const closeFilesToRight = useCallback(async (filePath: string) => {
    const openFiles = useStore.getState().openFiles
    const index = openFiles.findIndex(f => f.path === filePath)
    if (index >= 0) {
      for (let i = openFiles.length - 1; i > index; i--) {
        await closeFileWithConfirm(openFiles[i].path)
      }
    }
  }, [closeFileWithConfirm])

  // 触发自动保存
  // 触发自动保存 (使用 debounce 重构)
  const debouncedAutoSave = useRef<{ func: (filePath: string) => void, cancel: () => void } | null>(null)

  const triggerAutoSave = useCallback((filePath: string) => {
    const config = getEditorConfig()
    if (config.autoSave === 'off') return

    if (config.autoSave === 'afterDelay') {
      if (!debouncedAutoSave.current) {
        const doSave = async (fPath: string) => {
          const { openFiles: currentFiles, markFileSaved: currentMarkSaved } = useStore.getState()
          const file = currentFiles.find(f => f.path === fPath)
          if (file?.isDirty && isWritableDocumentKind(file.kind)) {
            const content = getEditorBufferContent(file.path, file.content)
            const success = await api.file.write(file.path, content, file.encoding)
            if (success) {
              commitEditorBufferSnapshot(file.path, content)
              const versionId = getModelVersionId(file.path)
              currentMarkSaved(file.path, versionId)
            }
          }
        }

        // 创建带有取消方法的 debounce
        let timer: NodeJS.Timeout | null = null
        debouncedAutoSave.current = {
          func: (fPath: string) => {
            if (timer) clearTimeout(timer)
            timer = setTimeout(() => doSave(fPath), config.autoSaveDelay)
          },
          cancel: () => {
            if (timer) clearTimeout(timer)
          }
        }
      }

      debouncedAutoSave.current.func(filePath)
    }
  }, [])

  // 失去焦点时自动保存
  useEffect(() => {
    const config = getEditorConfig()
    if (config.autoSave !== 'onFocusChange') return

    const handleBlur = async () => {
      const openFiles = useStore.getState().openFiles
      for (const file of openFiles) {
        if (file.isDirty && isWritableDocumentKind(file.kind)) {
          const content = getEditorBufferContent(file.path, file.content)
          const success = await api.file.write(file.path, content, file.encoding)
          if (success) {
            commitEditorBufferSnapshot(file.path, content)
            const versionId = getModelVersionId(file.path)
            markFileSaved(file.path, versionId)
          }
        }
      }
    }

    window.addEventListener('blur', handleBlur)
    return () => window.removeEventListener('blur', handleBlur)
  }, [markFileSaved])

  // 清理定时器
  useEffect(() => {
    return () => {
      if (debouncedAutoSave.current) {
        debouncedAutoSave.current.cancel()
      }
    }
  }, [])

  return {
    saveFile,
    closeFileWithConfirm,
    closeOtherFiles,
    closeAllFiles,
    closeSavedFiles,
    closeFilesToRight,
    triggerAutoSave,
  }
}
