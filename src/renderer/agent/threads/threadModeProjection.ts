import { normalizeMode, type WorkMode } from '@/shared/types/workMode'
import type { ChatThread } from '@/renderer/agent/types'

export function isTopLevelThreadForMode(thread: ChatThread | undefined, mode: WorkMode): boolean {
  return Boolean(thread && thread.origin !== 'plan-task' && normalizeMode(thread.mode) === mode)
}

export function projectThreadsForMode(threads: Iterable<ChatThread>, mode: WorkMode): ChatThread[] {
  return Array.from(threads)
    .filter(thread => isTopLevelThreadForMode(thread, mode))
    .sort((a, b) => b.lastModified - a.lastModified)
}

export function findMostRecentThreadForMode(threads: Iterable<ChatThread>, mode: WorkMode): ChatThread | undefined {
  return projectThreadsForMode(threads, mode)[0]
}
