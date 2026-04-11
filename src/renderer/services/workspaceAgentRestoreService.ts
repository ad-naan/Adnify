import { logger } from '@utils/Logger'
import { useAgentStore } from '@renderer/agent/store/AgentStore'
import { rehydrateWorkspaceAgentStore } from './workspaceLoadService'

export async function restoreWorkspaceAgentData(): Promise<void> {
  try {
    await rehydrateWorkspaceAgentStore()
    logger.system.debug('[WorkspaceAgentRestore] Agent store rehydrated')

    const state = useAgentStore.getState()
    const { threads, currentThreadId, createThread } = state

    if (Object.keys(threads).length === 0) {
      createThread()
      logger.system.info('[WorkspaceAgentRestore] Created initial thread')
      return
    }

    if (!currentThreadId || !threads[currentThreadId]) {
      const firstThreadId = Object.keys(threads)[0]
      useAgentStore.setState({ currentThreadId: firstThreadId })
      logger.system.info(`[WorkspaceAgentRestore] Activated first thread: ${firstThreadId}`)
    }

    const activeThreadId = useAgentStore.getState().currentThreadId
    if (activeThreadId && threads[activeThreadId]) {
      const messageCount = threads[activeThreadId].messages?.length || 0
      logger.system.info(`[WorkspaceAgentRestore] Current thread has ${messageCount} messages`)
    }
  } catch (e) {
    logger.system.warn('[WorkspaceAgentRestore] Agent store restore failed:', e)
  }
}
