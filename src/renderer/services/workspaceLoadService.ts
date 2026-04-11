import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useStore } from '@store'
import { useAgentStore } from '@renderer/agent/store/AgentStore'
import { suspendAgentStorageWrites, resumeAgentStorageWrites } from '@renderer/agent/store/agentStorage'
import { adnifyDir } from './adnifyDirService'
import { mcpService } from './mcpService'
import { gitService } from './gitService'
import { toAppError } from '@shared/utils/errorHandler'
import type { FileItem } from '@shared/types'
import type { WorkspaceConfig } from '@store'

export interface WorkspaceLoadOptions {
  rehydrateAgentStore?: boolean
  initializeMcp?: boolean
}

export interface WorkspaceShellState {
  workspace: WorkspaceConfig
  primaryRoot: string | null
  files: FileItem[]
}

export async function rehydrateWorkspaceAgentStore(): Promise<void> {
  const store = useAgentStore as typeof useAgentStore & {
    persist?: { rehydrate: () => Promise<void> }
  }

  if (!store.persist) return

  suspendAgentStorageWrites()
  try {
    await store.persist.rehydrate()
  } finally {
    resumeAgentStorageWrites()
  }

  logger.agent.info('[WorkspaceLoad] Agent store rehydrated')
}

export async function prepareWorkspaceShell(workspace: WorkspaceConfig): Promise<WorkspaceShellState> {
  if (workspace.roots.length === 0) {
    return {
      workspace,
      primaryRoot: null,
      files: [],
    }
  }

  const primaryRoot = workspace.roots[0]
  let files: FileItem[] = []

  try {
    files = await api.file.readDir(primaryRoot)
  } catch (err) {
    const error = toAppError(err)
    logger.system.error(`[WorkspaceLoad] Failed to read directory: ${error.code}`, error)
  }

  return {
    workspace,
    primaryRoot,
    files,
  }
}

export async function commitWorkspaceShell(shellState: WorkspaceShellState): Promise<void> {
  const { setWorkspace, setFiles } = useStore.getState()

  setWorkspace(shellState.workspace)
  setFiles(shellState.files)

  if (!shellState.primaryRoot) {
    gitService.setWorkspace(null)
    return
  }

  await adnifyDir.setPrimaryRoot(shellState.primaryRoot)
  gitService.setWorkspace(shellState.primaryRoot)
}

export async function initializeWorkspaceServices(
  workspace: WorkspaceConfig,
  options: WorkspaceLoadOptions = {}
): Promise<void> {
  const {
    rehydrateAgentStore: shouldRehydrateAgentStore = true,
    initializeMcp: shouldInitializeMcp = true,
  } = options

  if (shouldRehydrateAgentStore) {
    await rehydrateWorkspaceAgentStore()
  }

  if (shouldInitializeMcp) {
    await mcpService.initialize(workspace.roots)
  }
}

export async function loadWorkspace(
  workspace: WorkspaceConfig,
  options: WorkspaceLoadOptions = {}
): Promise<void> {
  const shellState = await prepareWorkspaceShell(workspace)
  await commitWorkspaceShell(shellState)
  await initializeWorkspaceServices(workspace, options)
}
