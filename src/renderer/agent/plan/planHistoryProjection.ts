import { normalizeMode } from '@/shared/types/workMode'
import type { ChatThread } from '@/renderer/agent/types'
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
    .filter(thread => thread.messages.some(message => message.role === 'user'))
    .map(thread => ({
      id: `thread:${thread.id}`,
      title: getThreadDisplayTitle(thread),
      updatedAt: thread.lastModified,
      threadId: thread.id,
    }))

  return [...planEntries, ...conversationEntries].sort((a, b) => b.updatedAt - a.updatedAt)
}
