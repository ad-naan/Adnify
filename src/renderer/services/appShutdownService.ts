import { useStore } from '@store'
import { logger } from '@utils/Logger'
import { flushAgentSessionPersistence, flushStreamingBuffer } from '@renderer/agent/store/AgentStore'
import { stageWorkspaceStatePersistence } from './workspaceStateService'
import { api } from './electronAPI'
import { persistenceCoordinator } from './persistence/PersistenceCoordinator'
import '@renderer/shell/services/shellRegistryService'
import './workspaceAnalyticsService'
import './aiAttributionService'
import './workspaceFileRepository'
import './agentSessionRepository'

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
  // 1. Flush in-memory streaming buffers into the store synchronously
  flushStreamingBuffer()

  // 2. Flush the debounced agent session state into the staging layer synchronously.
  //    This ensures the current debounced snapshot is staged before durable flush.
  flushAgentSessionPersistence()

  // 3. Capture the latest UI state, then cross the single lifecycle boundary.
  await stageWorkspaceStatePersistence()
  await Promise.all([
    persistenceCoordinator.flush('shutdown'),
    persistWorkspaceBinding(),
  ])
}
