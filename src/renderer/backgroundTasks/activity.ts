import type { BackgroundTaskActivity } from '@shared/types/backgroundTasks'
import type { ChatThread } from '../agent/types/thread'
import type { PlanTask, TaskPlan } from '../agent/plan/types'

type Thread = Pick<ChatThread, 'id' | 'streamState' | 'executionMeta' | 'isCompacting' | 'planId' | 'parentThreadId'>
type Plan = Pick<TaskPlan, 'id' | 'status'> & { tasks: Pick<PlanTask, 'id' | 'status' | 'threadId'>[] }

function threadState(thread: Thread): BackgroundTaskActivity['state'] {
  if (thread.isCompacting) return 'running'
  const phase = thread.streamState.phase
  const loop = thread.executionMeta?.loopState
  if (phase === 'tool_pending' || loop === 'waiting_for_user') return 'paused'
  if (loop === 'completed' || loop === 'failed' || loop === 'aborted') return 'idle'
  if (phase === 'streaming' || phase === 'tool_running' || loop === 'running' || loop === 'waiting_for_tools') return 'running'
  return 'idle'
}

/** Projects all threads, including tabs that are not currently visible. */
export function projectBackgroundActivity(threads: Record<string, Thread>, plans: Plan[], recentFailure = false): BackgroundTaskActivity {
  const states = new Map(Object.values(threads).map(thread => [thread.id, threadState(thread)]))
  const activePlans = plans.filter(plan => ['executing', 'pausing', 'paused', 'stopping'].includes(plan.status))
  const runningThreads = Object.values(threads).filter(thread => states.get(thread.id) === 'running')
  const planRunning = activePlans.some(plan => {
    if (plan.status !== 'executing') return false
    const running = plan.tasks.filter(task => task.status === 'running')
    if (running.length) return running.some(task => !task.threadId || states.get(task.threadId) !== 'paused')
    return plan.tasks.some(task => task.status === 'pending')
  })
  const running = runningThreads.length > 0 || planRunning
  const paused = [...states.values()].includes('paused') || activePlans.some(plan => plan.status === 'paused' || plan.status === 'pausing')
  const state = running ? 'running' : recentFailure ? 'error' : paused ? 'paused' : 'idle'
  // Ordinary agent turns have no honest percentage. A plan measures completed task count.
  const belongsToPlan = (thread: Thread): boolean => activePlans.some(plan =>
    thread.planId === plan.id || plan.tasks.some(task => task.threadId === thread.id
      || task.id === thread.executionMeta?.planTaskId)
    || (thread.parentThreadId && threads[thread.parentThreadId] && belongsToPlanParent(thread.parentThreadId, plan.id)),
  )
  const belongsToPlanParent = (id: string, planId: string): boolean => {
    const visited = new Set<string>()
    let current: Thread | undefined = threads[id]
    while (current && !visited.has(current.id)) {
      visited.add(current.id)
      if (current.planId === planId || activePlans.find(plan => plan.id === planId)?.tasks.some(task => task.threadId === current?.id)) return true
      current = current.parentThreadId ? threads[current.parentThreadId] : undefined
    }
    return false
  }
  const tasks = activePlans.flatMap(plan => plan.tasks)
  if (state !== 'idle' && tasks.length && runningThreads.every(belongsToPlan)) {
    return { state, progress: tasks.filter(task => task.status === 'completed' || task.status === 'skipped').length / tasks.length }
  }
  return { state }
}
