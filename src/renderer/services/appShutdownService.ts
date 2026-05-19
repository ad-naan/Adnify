import { useStore } from '@store'
import { logger } from '@utils/Logger'
import { flushAgentSessionPersistence, flushStreamingBuffer } from '@renderer/agent/store/AgentStore'
import { flushWorkspaceStatePersistence } from './workspaceStateService'
import { adnifyDir } from './adnifyDirService'
import { api } from './electronAPI'
import { shellRegistryService } from '@renderer/shell/services/shellRegistryService'
import { workspaceAnalyticsService } from './workspaceAnalyticsService'
import { aiAttributionService } from './aiAttributionService'

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
  //    This ensures any pending 240ms-debounced snapshot is staged before we write to disk.
  flushAgentSessionPersistence()

  // 3. Persist workspace analytics and workspace state (independent of agent sessions)
  await workspaceAnalyticsService.flush()
  await aiAttributionService.flush()
  await flushWorkspaceStatePersistence()

  // 4. Flush the adnifyDir service FIRST — it owns the actual disk writes for agent sessions.
  //    agentSessionRepository.flush() delegates to adnifyDir.flush() internally, so calling
  //    adnifyDir.flush() once is sufficient and avoids a redundant no-op second pass.
  await Promise.all([
    adnifyDir.flush(),
    shellRegistryService.flush(),
    persistWorkspaceBinding(),
  ])
}
