import { adnifyDir, type AgentSessionSnapshot } from './adnifyDirService'

class AgentSessionRepository {
  getSnapshot(): Promise<AgentSessionSnapshot | null> {
    return adnifyDir.getAgentSessionSnapshot()
  }

  stageSnapshot(snapshot: AgentSessionSnapshot): void {
    adnifyDir.stageAgentSessionSnapshot(snapshot)
  }

  loadThreadMessages(threadId: string): Promise<any[]> {
    return adnifyDir.loadThreadMessages(threadId)
  }

  deleteThread(threadId: string): Promise<void> {
    return adnifyDir.deleteThreadData(threadId)
  }

  clear(): Promise<void> {
    return adnifyDir.clearAllSessions()
  }

  flush(): Promise<void> {
    return adnifyDir.flush()
  }
}

export const agentSessionRepository = new AgentSessionRepository()
export type { AgentSessionSnapshot }
