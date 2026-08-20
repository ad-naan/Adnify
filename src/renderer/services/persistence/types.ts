import type { ChatThread } from '@/renderer/agent/types'

export interface AgentSessionSnapshot {
  threads: Record<string, ChatThread>
  threadMessageVersions?: Record<string, number>
  currentThreadId: string | null
  branches: Record<string, unknown>
  activeBranchId: Record<string, unknown>
  version: number
}
