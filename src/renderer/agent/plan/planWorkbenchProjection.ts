import type { ChatThread, InteractiveContent } from '@/renderer/agent/types'
import { getMessageText, isAssistantMessage } from '@/renderer/agent/types'
import type { PlanTask, TaskPlan } from './types'
import { PLAN_ACTIVITY_STAGES, PLAN_ACTIVITY_STATUSES, type PlanActivityStage, type PlanActivityStatus } from '@/shared/types/planActivity'

export type { PlanActivityStatus } from '@/shared/types/planActivity'
import { derivePlanPlanningState, type PlanPlanningState } from './planWorkflowGuard'

export type PlanWorkbenchStage = PlanActivityStage

export interface PlanActivityItem {
  id: string
  stage: PlanWorkbenchStage
  title: string
  detail?: string
  status: PlanActivityStatus
  taskId?: string
  progress?: number
  timestamp: number
}

export interface PlanTaskRuntimeItem {
  task: PlanTask
  thread?: ChatThread
  waitingApproval: boolean
  currentToolName?: string
  currentToolArguments?: Record<string, unknown>
  requestId?: string
  latestText?: string
}

export interface PlanClarificationItem {
  messageId: string
  content: InteractiveContent
}

export interface PlanWorkbenchFocus {
  stage: PlanWorkbenchStage
  title: string
  detail?: string
  progress?: number
  tone: PlanActivityStatus
}

export interface PlanWorkbenchProjection {
  stage: PlanWorkbenchStage
  planningState: PlanPlanningState
  hasSession: boolean
  focus: PlanWorkbenchFocus | null
  requestText?: string
  requestTimestamp?: number
  clarification?: PlanClarificationItem
  activities: PlanActivityItem[]
  tasks: PlanTaskRuntimeItem[]
  approvals: PlanTaskRuntimeItem[]
  activeTasks: PlanTaskRuntimeItem[]
  queuedTasks: PlanTaskRuntimeItem[]
  finishedTasks: PlanTaskRuntimeItem[]
  completedCount: number
  progress: number
  canStart: boolean
}

const ACTIVITY_STAGES = new Set<PlanWorkbenchStage>(PLAN_ACTIVITY_STAGES)
const ACTIVITY_STATUSES = new Set<PlanActivityStatus>(PLAN_ACTIVITY_STATUSES)

function toActivity(args: Record<string, unknown>, id: string, timestamp: number): PlanActivityItem | null {
  const title = typeof args.title === 'string' ? args.title.trim() : ''
  if (!title || !ACTIVITY_STAGES.has(args.stage as PlanWorkbenchStage)) return null

  return {
    id,
    stage: args.stage as PlanWorkbenchStage,
    title,
    detail: typeof args.detail === 'string' && args.detail.trim() ? args.detail.trim() : undefined,
    status: ACTIVITY_STATUSES.has(args.status as PlanActivityStatus) ? args.status as PlanActivityStatus : 'active',
    taskId: typeof args.taskId === 'string' ? args.taskId : undefined,
    progress: typeof args.progress === 'number' ? Math.max(0, Math.min(100, Math.round(args.progress))) : undefined,
    timestamp,
  }
}

function getRelevantThreads(plan: TaskPlan | undefined, currentThreadId: string | null, threads: Record<string, ChatThread>): ChatThread[] {
  const ids = new Set<string>()
  if (currentThreadId) ids.add(currentThreadId)
  if (plan?.originThreadId) ids.add(plan.originThreadId)
  for (const task of plan?.tasks || []) if (task.threadId) ids.add(task.threadId)
  if (plan) {
    for (const thread of Object.values(threads)) if (thread.planId === plan.id) ids.add(thread.id)
  }
  return Array.from(ids).map(id => threads[id]).filter(Boolean)
}

function getPlanningThread(plan: TaskPlan | undefined, currentThreadId: string | null, threads: Record<string, ChatThread>): ChatThread | undefined {
  if (plan?.originThreadId && threads[plan.originThreadId]) return threads[plan.originThreadId]
  return currentThreadId ? threads[currentThreadId] : undefined
}

function deriveStage(plan: TaskPlan | undefined, planningState: PlanPlanningState, tasks: PlanTaskRuntimeItem[]): PlanWorkbenchStage {
  if (!plan) return planningState === 'ready_to_create' || planningState === 'plan_created' ? 'plan' : 'requirements'
  if (['executing', 'pausing', 'paused', 'stopping'].includes(plan.status)) return 'execution'
  if (plan.status === 'completed' || (tasks.length > 0 && tasks.every(item => ['completed', 'failed', 'skipped', 'cancelled'].includes(item.task.status)))) return 'validation'
  return 'plan'
}

export function projectPlanWorkbench(input: {
  plan?: TaskPlan
  currentThreadId: string | null
  threads: Record<string, ChatThread>
}): PlanWorkbenchProjection {
  const { plan, currentThreadId, threads } = input
  const planningThread = getPlanningThread(plan, currentThreadId, threads)
  const planningMessages = planningThread?.messages || []
  const planningState = derivePlanPlanningState(planningMessages)
  const relevantThreads = getRelevantThreads(plan, currentThreadId, threads)

  const activities = relevantThreads.flatMap(thread => thread.messages.flatMap(message => {
    if (!isAssistantMessage(message)) return []
    return (message.toolCalls || []).flatMap((toolCall, index) => {
      if (toolCall.name !== 'report_plan_activity') return []
      const item = toActivity(toolCall.arguments, `${thread.id}:${toolCall.id}`, message.timestamp + index)
      return item ? [item] : []
    })
  })).sort((a, b) => a.timestamp - b.timestamp)

  const tasks: PlanTaskRuntimeItem[] = (plan?.tasks || []).map(task => {
    const thread = task.threadId ? threads[task.threadId] : undefined
    const latestAssistant = thread ? [...thread.messages].reverse().find(isAssistantMessage) : undefined
    return {
      task,
      thread,
      waitingApproval: thread?.streamState.phase === 'tool_pending',
      currentToolName: thread?.streamState.currentToolCall?.name,
      currentToolArguments: thread?.streamState.currentToolCall?.arguments,
      requestId: task.requestId || thread?.streamState.requestId,
      latestText: latestAssistant ? getMessageText(latestAssistant.content).trim() : undefined,
    }
  })

  const clarificationMessage = [...planningMessages].reverse().find(message =>
    isAssistantMessage(message) && message.interactive && !message.interactive.selectedIds?.length
  )
  const clarification = clarificationMessage && isAssistantMessage(clarificationMessage) && clarificationMessage.interactive
    ? { messageId: clarificationMessage.id, content: clarificationMessage.interactive }
    : undefined
  const latestCompletedPlanIndex = planningMessages.reduce((latest, message, index) => (
    isAssistantMessage(message) && message.toolCalls?.some(toolCall => toolCall.name === 'create_task_plan') ? index : latest
  ), -1)
  const requestMessage = planningMessages.slice(latestCompletedPlanIndex + 1).find(message => message.role === 'user')
  const requestText = plan?.userRequest || (requestMessage ? getMessageText(requestMessage.content).trim() : undefined)

  const approvals = tasks.filter(item => item.waitingApproval)
  const activeTasks = tasks.filter(item => item.task.status === 'running' && !item.waitingApproval)
  const queuedTasks = tasks.filter(item => item.task.status === 'pending')
  const finishedTasks = tasks.filter(item => ['completed', 'failed', 'skipped', 'cancelled'].includes(item.task.status))
  const completedCount = tasks.filter(item => item.task.status === 'completed').length
  const progress = tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0
  const stage = deriveStage(plan, planningState, tasks)
  const latestActivity = activities.at(-1)

  let focus: PlanWorkbenchFocus | null = latestActivity ? {
    stage: latestActivity.stage,
    title: latestActivity.title,
    detail: latestActivity.detail,
    progress: latestActivity.progress,
    tone: latestActivity.status,
  } : null

  if (!focus && approvals[0]) {
    focus = { stage: 'execution', title: approvals[0].task.title, detail: approvals[0].currentToolName, tone: 'warning' }
  }
  if (!focus && activeTasks[0]) {
    focus = { stage: 'execution', title: activeTasks[0].task.title, detail: activeTasks[0].currentToolName || activeTasks[0].latestText, tone: 'active' }
  }
  if (!focus && planningThread?.streamState.phase === 'tool_running' && planningThread.streamState.currentToolCall) {
    focus = { stage, title: planningThread.streamState.currentToolCall.name, detail: planningThread.streamState.statusText, tone: 'active' }
  }
  if (!focus && planningThread?.streamState.statusText) {
    focus = { stage, title: planningThread.streamState.statusText, tone: planningThread.streamState.phase === 'error' ? 'blocked' : 'active' }
  }

  const hasLiveThread = relevantThreads.some(thread => ['streaming', 'tool_pending', 'tool_running'].includes(thread.streamState.phase))

  return {
    stage,
    planningState,
    hasSession: Boolean(plan || requestText || clarification || activities.length || hasLiveThread),
    focus,
    requestText,
    requestTimestamp: requestMessage?.timestamp,
    clarification,
    activities,
    tasks,
    approvals,
    activeTasks,
    queuedTasks,
    finishedTasks,
    completedCount,
    progress,
    canStart: Boolean(plan && ['draft', 'approved', 'stopped', 'failed'].includes(plan.status) && queuedTasks.length > 0),
  }
}
