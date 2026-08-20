import { normalizeMode } from '@/shared/types/workMode'
import type { ChatMessage, ChatThread } from '@/renderer/agent/types'
import { getThreadDisplayTitle } from '@/renderer/agent/types'
import type { TaskPlan } from './types'

export interface PlanHistoryEntry {
  id: string
  title: string
  updatedAt: number
  threadId?: string
  planId?: string
  status?: TaskPlan['status']
  taskCount?: number
  completedCount?: number
}

/**
 * `messages.some(role === 'user')` per thread, re-run on every store transition,
 * was a full history scan for every plan thread. The answer only flips once (a
 * thread never loses its first user message), so cache it by array identity.
 */
const hasUserMessageCache = new WeakMap<readonly ChatMessage[], boolean>()

function hasUserMessage(thread: ChatThread): boolean {
  const cached = hasUserMessageCache.get(thread.messages)
  if (cached !== undefined) return cached

  const result = thread.messages.some(message => message.role === 'user')
  hasUserMessageCache.set(thread.messages, result)
  return result
}

export function projectPlanHistory(plans: TaskPlan[], threads: Record<string, ChatThread>): PlanHistoryEntry[] {
  const linkedThreads = new Set(plans.map(plan => plan.originThreadId).filter(Boolean))
  const planEntries = plans.map(plan => ({
    id: `plan:${plan.id}`,
    title: plan.name,
    updatedAt: plan.updatedAt,
    threadId: plan.originThreadId,
    planId: plan.id,
    status: plan.status,
    taskCount: plan.tasks.length,
    completedCount: plan.tasks.filter(task => task.status === 'completed').length,
  }))
  const conversationEntries = Object.values(threads)
    .filter(thread => normalizeMode(thread.mode) === 'plan' && thread.origin !== 'plan-task' && !linkedThreads.has(thread.id))
    .filter(thread => hasUserMessage(thread))
    .map(thread => ({
      id: `thread:${thread.id}`,
      title: getThreadDisplayTitle(thread),
      updatedAt: thread.lastModified,
      threadId: thread.id,
    }))

  return [...planEntries, ...conversationEntries].sort((a, b) => b.updatedAt - a.updatedAt)
}
