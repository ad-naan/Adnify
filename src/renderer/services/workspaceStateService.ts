/**
 * Workspace state persistence service.
 * Saves and restores open files, active file, layout, and expanded folders.
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useStore } from '@store'
import type { OpenFile } from '@store'
import { getEditorConfig } from '@renderer/settings'
import { workspaceStateRepository, type WorkspaceStateData } from './workspaceStateRepository'
import { isPreviewDocumentPath } from '@shared/types/preview'

type PersistedWorkspaceOpenFile = Exclude<WorkspaceStateData['openFiles'][number], string>

async function readFilesWithConcurrency(
  filePaths: string[],
  concurrency = 4
): Promise<Array<{ path: string; content: string }>> {
  const results: Array<{ path: string; content: string }> = []

  for (let i = 0; i < filePaths.length; i += concurrency) {
    const batch = filePaths.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map(async (filePath) => {
        try {
          // 恢复的内容会回填到编辑器缓冲区，随后可能被保存回磁盘，
          // 所以必须读完整文件而不是预览切片。
          const fileContent = await api.file.read(filePath, undefined, { full: true })
          return fileContent !== null ? { path: filePath, content: fileContent } : null
        } catch {
          logger.system.warn('[WorkspaceState] Failed to restore file:', filePath)
          return null
        }
      })
    )

    results.push(...batchResults.filter((item): item is { path: string; content: string } => item !== null))
  }

  return results
}

function toPersistedOpenFile(file: OpenFile): WorkspaceStateData['openFiles'][number] | null {
  if (file.pinned) return null
  if (file.kind === 'preview' && file.preview) {
    return {
      path: file.path,
      kind: 'preview',
      preview: file.preview,
    }
  }

  if (file.kind === 'diff') {
    return null
  }

  return file.path
}

function normalizePersistedOpenFiles(
  openFiles: WorkspaceStateData['openFiles'],
): {
  filePaths: string[]
  previewFiles: PersistedWorkspaceOpenFile[]
} {
  const filePaths: string[] = []
  const previewFiles: PersistedWorkspaceOpenFile[] = []

  for (const item of openFiles) {
    if (typeof item === 'string') {
      filePaths.push(item)
      continue
    }

    if (item.kind === 'preview' && item.preview) {
      previewFiles.push(item)
      continue
    }

    if (!isPreviewDocumentPath(item.path)) {
      filePaths.push(item.path)
    }
  }

  return { filePaths, previewFiles }
}

export async function saveWorkspaceState(): Promise<void> {
  const { openFiles, activeFilePath, expandedFolders, sidebarWidth, chatWidth, terminalLayout } = useStore.getState()
  const persistedOpenFiles = openFiles
    .map(toPersistedOpenFile)
    .filter((file): file is WorkspaceStateData['openFiles'][number] => file !== null)
  const persistedOpenFilePaths = new Set(persistedOpenFiles.map((file) => typeof file === 'string' ? file : file.path))

  const state: WorkspaceStateData = {
    openFiles: persistedOpenFiles,
    activeFile: activeFilePath && persistedOpenFilePaths.has(activeFilePath) ? activeFilePath : null,
    expandedFolders: Array.from(expandedFolders),
    scrollPositions: {},
    cursorPositions: {},
    layout: {
      sidebarWidth,
      chatWidth,
      terminalVisible: false,
      terminalLayout,
    },
  }

  await workspaceStateRepository.save(state)
  logger.system.info('[WorkspaceState] Saved:', state.openFiles.length, 'files')
}

export async function stageWorkspaceStatePersistence(): Promise<void> {
  if (saveTimeout) {
    clearTimeout(saveTimeout)
    saveTimeout = null
  }

  await saveWorkspaceState()
}

export async function restoreWorkspaceState(): Promise<void> {
  const { restoreOpenFiles, setSidebarWidth, setChatWidth, setTerminalVisible, setTerminalLayout } = useStore.getState()

  const state = await workspaceStateRepository.get()
  if (!state.openFiles.length && !state.layout) {
    logger.system.info('[WorkspaceState] No saved state')
    return
  }

  logger.system.info('[WorkspaceState] Restoring:', state.openFiles.length, 'files')

  if (state.expandedFolders.length > 0) {
    useStore.setState((current) => ({
      expandedFolders: new Set([...current.expandedFolders, ...state.expandedFolders]),
    }))
  }

  if (state.openFiles.length > 0) {
    const { filePaths, previewFiles } = normalizePersistedOpenFiles(state.openFiles)
    const prioritizedFiles = state.activeFile && !isPreviewDocumentPath(state.activeFile)
      ? [state.activeFile, ...filePaths.filter(filePath => filePath !== state.activeFile)]
      : filePaths

    const restoredFiles = await readFilesWithConcurrency(prioritizedFiles)
    const restoredPreviewFiles = previewFiles.map((item) => ({
      path: item.path,
      content: '',
      options: {
        kind: 'preview' as const,
        preview: item.preview,
      },
    }))

    const mergedFiles = [...restoredFiles, ...restoredPreviewFiles]
    if (mergedFiles.length > 0) {
      restoreOpenFiles(mergedFiles, state.activeFile)
    }
  }

  if (state.layout) {
    setSidebarWidth(state.layout.sidebarWidth)
    setChatWidth(state.layout.chatWidth)
    setTerminalVisible(state.layout.terminalVisible)
    setTerminalLayout(state.layout.terminalLayout)
  }

  logger.system.info('[WorkspaceState] Restored successfully')
}

let saveTimeout: NodeJS.Timeout | null = null

export function scheduleStateSave(): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout)
  }

  saveTimeout = setTimeout(() => {
    saveWorkspaceState()
  }, getEditorConfig().performance.saveDebounceMs)
}

export function initWorkspaceStateSync(): () => void {
  const unsubscribe = useStore.subscribe(
    (state, prevState) => {
      if (
        state.openFiles !== prevState.openFiles ||
        state.activeFilePath !== prevState.activeFilePath ||
        state.expandedFolders !== prevState.expandedFolders ||
        state.sidebarWidth !== prevState.sidebarWidth ||
        state.chatWidth !== prevState.chatWidth ||
        state.terminalVisible !== prevState.terminalVisible ||
        state.terminalLayout !== prevState.terminalLayout
      ) {
        scheduleStateSave()
      }
    }
  )

  return () => {
    unsubscribe()
    if (saveTimeout) {
      clearTimeout(saveTimeout)
    }
  }
}
