/**
 * Workspace state persistence service.
 * Saves and restores open files, active file, layout, and expanded folders.
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useStore } from '@store'
import { getEditorConfig } from '@renderer/settings'
import { workspaceStateRepository, type WorkspaceStateData } from './workspaceStateRepository'

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
          const fileContent = await api.file.read(filePath)
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

export async function saveWorkspaceState(): Promise<void> {
  const { openFiles, activeFilePath, expandedFolders, sidebarWidth, chatWidth, terminalLayout } = useStore.getState()

  const state: WorkspaceStateData = {
    openFiles: openFiles.map((f: { path: string }) => f.path),
    activeFile: activeFilePath,
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

export async function flushWorkspaceStatePersistence(): Promise<void> {
  if (saveTimeout) {
    clearTimeout(saveTimeout)
    saveTimeout = null
  }

  await saveWorkspaceState()
  await workspaceStateRepository.flush()
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
    const prioritizedFiles = state.activeFile
      ? [state.activeFile, ...state.openFiles.filter(filePath => filePath !== state.activeFile)]
      : state.openFiles

    const restoredFiles = await readFilesWithConcurrency(prioritizedFiles)
    if (restoredFiles.length > 0) {
      restoreOpenFiles(restoredFiles, state.activeFile)
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

  const handleBeforeUnload = async () => {
    await flushWorkspaceStatePersistence()
  }
  window.addEventListener('beforeunload', handleBeforeUnload)

  return () => {
    unsubscribe()
    window.removeEventListener('beforeunload', handleBeforeUnload)
    if (saveTimeout) {
      clearTimeout(saveTimeout)
    }
  }
}
