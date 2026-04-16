import { useStore } from '@store'
import { logger } from '@utils/Logger'
import { flushAgentSessionPersistence, flushStreamingBuffer } from '@renderer/agent/store/AgentStore'
import { agentSessionRepository } from './agentSessionRepository'
import { flushWorkspaceStatePersistence } from './workspaceStateService'
import { adnifyDir } from './adnifyDirService'
import { api } from './electronAPI'
import { shellRegistryService } from '@renderer/shell/services/shellRegistryService'

async function persistWorkspaceBinding(): Promise<void> {
  const workspace = useStore.getState().workspace
  if (!workspace || workspace.roots.length === 0) {
    return
  }

  try {
    await api.workspace.save(workspace.configPath || '', workspace.roots)
  } catch (error) {
    logger.system.warn('[Shutdown] Failed to persist workspace binding:', error)
  }
}

export async function persistAllRuntimeState(): Promise<void> {
  flushStreamingBuffer()
  flushAgentSessionPersistence()

  await flushWorkspaceStatePersistence()
  await Promise.all([
    agentSessionRepository.flush(),
    shellRegistryService.flush(),
    persistWorkspaceBinding(),
  ])
  await adnifyDir.flush()
}
