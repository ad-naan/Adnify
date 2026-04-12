import { logger } from '@utils/Logger'
import { useAgentStore } from '@renderer/agent/store/AgentStore'
import { hydrateThreadMessages, rehydrateWorkspaceAgentStore } from './workspaceLoadService'

export async function restoreWorkspaceAgentData(): Promise<void> {
  try {
    await rehydrateWorkspaceAgentStore()
    logger.system.debug('[WorkspaceAgentRestore] Agent store restored from workspace snapshot')

    const state = useAgentStore.getState()
    const { threads, currentThreadId } = state
    const threadIds = Object.keys(threads)
    logger.system.info('[WorkspaceAgentRestore] Store state after restore', {
      threadCount: threadIds.length,
      currentThreadId,
      threadIds,
    })

    if (threadIds.length === 0) {
      logger.system.info('[WorkspaceAgentRestore] No persisted threads found, leaving store empty')
      return
    }

    if (!currentThreadId || !threads[currentThreadId]) {
      const firstThreadId = threadIds[0]
      useAgentStore.setState({ currentThreadId: firstThreadId })
      logger.system.info(`[WorkspaceAgentRestore] Activated first thread: ${firstThreadId}`)
    }

    const activeThreadId = useAgentStore.getState().currentThreadId
    if (activeThreadId && threads[activeThreadId]) {
      const messageCount = threads[activeThreadId].messages?.length || 0
      logger.system.info(`[WorkspaceAgentRestore] Current thread has ${messageCount} messages`)
      void hydrateThreadMessages(activeThreadId).catch(error => {
        logger.system.warn('[WorkspaceAgentRestore] Active thread hydration failed:', error)
      })
    }
  } catch (e) {
    logger.system.warn('[WorkspaceAgentRestore] Agent store restore failed:', e)
  }
}
