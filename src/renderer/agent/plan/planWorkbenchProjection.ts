import type { ChatThread, InteractiveContent } from '@/renderer/agent/types'
import { getMessageText, isAssistantMessage } from '@/renderer/agent/types'
import type { PlanTask, TaskPlan } from './types'
import { PLAN_ACTIVITY_STAGES, PLAN_ACTIVITY_STATUSES, type PlanActivityStage, type PlanActivityStatus } from '@/shared/types/planActivity'

export type { PlanActivityStatus } from '@/shared/types/planActivity'
import { derivePlanPlanningState, type PlanPlanningState } from './planWorkflowGuard'
import { layoutPlanGraph } from './planGraphLayout'

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
  source: 'ai' | 'tool'
}

export interface PlanTaskRuntimeItem {
  task: PlanTask
  thread?: ChatThread
  waitingApproval: boolean
  currentToolName?: string
  currentToolArguments?: Record<string, unknown>
  requestId?: string
  latestText?: string
  latestActivity?: PlanActivityItem
  subAgents: PlanSubAgentRuntimeItem[]
}

export interface PlanSubAgentRuntimeItem {
  id: string
  description: string
  threadId?: string
  startedAt?: number
  durationMs?: number
  status: 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed'
  currentAction?: string
  currentToolName?: string
  currentToolArguments?: Record<string, unknown>
  requestId?: string
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
  answeredClarification?: { question: string, answers: string[] }
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
  isProcessing: boolean
  review?: PlanReviewProjection
}

export interface PlanRoleAllocation {
  key: string
  role: string
  provider: string
  model: string
  taskCount: number
}

export interface PlanReviewRisk {
  id: string
  severity: 'warning' | 'error'
  title: string
  detail: string
  titleZh: string
  detailZh: string
}

export interface PlanReviewProjection {
  taskCount: number
  maxParallelism: number
  declaredArtifacts: number
  estimatedTokens: number
  allocations: PlanRoleAllocation[]
  risks: PlanReviewRisk[]
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
    source: 'ai',
  }
}

const TOOL_TITLES: Record<string, string> = {
  ask_user: '确认需求',
  create_task_plan: '生成结构化计划',
  read_file: '读取文件',
  read_files: '读取文件',
  search_files: '搜索项目',
  list_directory: '浏览目录',
  run_command: '运行命令',
  task: '调度子任务',
}

function toolDetail(args: Record<string, unknown>): string | undefined {
  for (const key of ['description', 'question', 'path', 'filePath', 'command', 'prompt']) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 180)
  }
  for (const key of ['paths', 'files']) {
    const value = args[key]
    if (Array.isArray(value)) return value.filter(item => typeof item === 'string').slice(0, 4).join('、')
  }
  return undefined
}

function toolStatus(status: string): PlanActivityStatus {
  if (status === 'success') return 'completed'
  if (status === 'error' || status === 'rejected') return 'blocked'
  return 'active'
}

function getRelevantThreads(plan: TaskPlan | undefined, currentThreadId: string | null, threads: Record<string, ChatThread>): ChatThread[] {
  const ids = new Set<string>()
  if (currentThreadId) ids.add(currentThreadId)
  if (plan?.originThreadId) ids.add(plan.originThreadId)
  for (const task of plan?.tasks || []) if (task.threadId) ids.add(task.threadId)
  if (plan) {
    for (const thread of Object.values(threads)) if (thread.planId === plan.id) ids.add(thread.id)
  }
  for (const id of Array.from(ids)) {
    const thread = threads[id]
    for (const message of thread?.messages || []) {
      if (!isAssistantMessage(message)) continue
      for (const toolCall of message.toolCalls || []) {
        if (toolCall.name !== 'task') continue
        const meta = toolCall.arguments._meta
        if (!meta || typeof meta !== 'object' || Array.isArray(meta)) continue
        const subAgentThreadId = (meta as Record<string, unknown>).subAgentThreadId
        if (typeof subAgentThreadId === 'string') ids.add(subAgentThreadId)
      }
    }
  }
  return Array.from(ids).map(id => threads[id]).filter(Boolean)
}

function projectSubAgents(thread: ChatThread | undefined, threads: Record<string, ChatThread>): PlanSubAgentRuntimeItem[] {
  if (!thread) return []
  return thread.messages.flatMap(message => {
    if (!isAssistantMessage(message)) return []
    return (message.toolCalls || []).flatMap(toolCall => {
      if (toolCall.name !== 'task') return []
      const meta = toolCall.arguments._meta
      const values = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta as Record<string, unknown> : {}
      const threadId = typeof values.subAgentThreadId === 'string' ? values.subAgentThreadId : undefined
      const child = threadId ? threads[threadId] : undefined
      const latestAssistant = child ? [...child.messages].reverse().find(isAssistantMessage) : undefined
      const metaStatus = typeof values.subAgentStatus === 'string' ? values.subAgentStatus : undefined
      const status: PlanSubAgentRuntimeItem['status'] = child?.streamState.phase === 'tool_pending'
        ? 'waiting_approval'
        : child && (child.executionMeta?.loopState === 'running' || ['streaming', 'tool_running'].includes(child.streamState.phase))
          ? 'running'
          : metaStatus === 'completed' || toolCall.status === 'success'
            ? 'completed'
            : metaStatus === 'failed' || ['error', 'rejected'].includes(toolCall.status)
              ? 'failed'
              : toolCall.status === 'running'
                ? 'running'
                : 'queued'
      return [{
        id: toolCall.id,
        description: typeof toolCall.arguments.description === 'string' ? toolCall.arguments.description : 'Sub-agent task',
        threadId,
        startedAt: typeof values.subAgentStartedAt === 'number' ? values.subAgentStartedAt : undefined,
        durationMs: typeof values.subAgentDurationMs === 'number' ? values.subAgentDurationMs : undefined,
        status,
        currentAction: child?.streamState.statusText || (latestAssistant ? getMessageText(latestAssistant.content).trim() : undefined),
        currentToolName: child?.streamState.currentToolCall?.name,
        currentToolArguments: child?.streamState.currentToolCall?.arguments,
        requestId: child?.streamState.requestId,
      }]
    })
  })
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

export function projectPlanReview(plan: TaskPlan): PlanReviewProjection {
  const graph = layoutPlanGraph(plan.tasks)
  const countsByRank = new Map<number, number>()
  for (const node of graph.nodes) countsByRank.set(node.rank, (countsByRank.get(node.rank) || 0) + 1)

  const allocationMap = new Map<string, PlanRoleAllocation>()
  for (const task of plan.tasks) {
    const key = `${task.role}\u0000${task.provider}\u0000${task.model}`
    const current = allocationMap.get(key)
    if (current) current.taskCount += 1
    else allocationMap.set(key, { key, role: task.role, provider: task.provider, model: task.model, taskCount: 1 })
  }

  const risks: PlanReviewRisk[] = []
  if (graph.hasCycle) risks.push({ id: 'dependency-cycle', severity: 'error', title: 'Dependency cycle', detail: 'At least one task is part of a circular dependency and cannot be scheduled safely.', titleZh: '存在循环依赖', detailZh: '至少一个任务处于循环依赖中，调度器无法安全执行该计划。' })
  if (graph.missingDependencies.length) risks.push({ id: 'missing-dependency', severity: 'error', title: 'Missing dependency', detail: `${graph.missingDependencies.length} dependency references do not match a task in this plan.`, titleZh: '依赖任务缺失', detailZh: `${graph.missingDependencies.length} 个依赖引用未匹配到当前计划中的任务。` })

  if (plan.executionMode === 'parallel') {
    const nodesByRank = new Map<number, PlanTask[]>()
    for (const node of graph.nodes) nodesByRank.set(node.rank, [...(nodesByRank.get(node.rank) || []), node.task])
    for (const [rank, rankedTasks] of nodesByRank) {
      const writers = new Map<string, string[]>()
      for (const task of rankedTasks) for (const file of task.producesFiles || []) writers.set(file, [...(writers.get(file) || []), task.title])
      for (const [file, taskTitles] of writers) {
        if (taskTitles.length < 2) continue
        risks.push({ id: `write-conflict:${rank}:${file}`, severity: 'warning', title: 'Parallel write conflict', detail: `${taskTitles.join(', ')} may write ${file} in the same scheduling layer.`, titleZh: '并行写入冲突', detailZh: `${taskTitles.join('、')} 可能在同一调度层写入 ${file}。` })
      }
    }
  }

  return {
    taskCount: plan.tasks.length,
    maxParallelism: Math.max(0, ...countsByRank.values()),
    declaredArtifacts: new Set(plan.tasks.flatMap(task => task.producesFiles || [])).size,
    estimatedTokens: plan.tasks.reduce((total, task) => total + (task.estimatedTokens || 0), 0),
    allocations: Array.from(allocationMap.values()).sort((a, b) => b.taskCount - a.taskCount || a.role.localeCompare(b.role)),
    risks,
  }
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

  const reportedActivities = relevantThreads.flatMap(thread => thread.messages.flatMap(message => {
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
      subAgents: projectSubAgents(thread, threads),
    }
  })

  const clarificationMessage = [...planningMessages].reverse().find(message =>
    isAssistantMessage(message) && message.interactive && !message.interactive.selectedIds?.length
  )
  const clarification = clarificationMessage && isAssistantMessage(clarificationMessage) && clarificationMessage.interactive
    ? { messageId: clarificationMessage.id, content: clarificationMessage.interactive }
    : undefined
  const answeredMessage = [...planningMessages].reverse().find(message =>
    isAssistantMessage(message) && message.interactive?.selectedIds?.length
  )
  const answeredClarification = answeredMessage && isAssistantMessage(answeredMessage) && answeredMessage.interactive
    ? {
        question: answeredMessage.interactive.question,
        answers: answeredMessage.interactive.options
          .filter(option => answeredMessage.interactive?.selectedIds?.includes(option.id))
          .map(option => option.label),
      }
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
  const taskIdByThread = new Map(tasks.flatMap(item => item.thread ? [[item.thread.id, item.task.id] as const] : []))
  const toolActivities: PlanActivityItem[] = relevantThreads.flatMap(thread => thread.messages.flatMap(message => {
    if (!isAssistantMessage(message)) return []
    return (message.toolCalls || []).flatMap((toolCall, index) => {
      if (toolCall.name === 'report_plan_activity') return []
      return [{
        id: `${thread.id}:tool:${toolCall.id}`,
        stage,
        title: TOOL_TITLES[toolCall.name] || toolCall.name.replaceAll('_', ' '),
        detail: toolDetail(toolCall.arguments),
        status: toolStatus(toolCall.status),
        taskId: taskIdByThread.get(thread.id),
        timestamp: message.timestamp + index,
        source: 'tool',
      } satisfies PlanActivityItem]
    })
  }))
  const activities = [...reportedActivities, ...toolActivities].sort((a, b) => a.timestamp - b.timestamp)
  for (const task of tasks) {
    task.latestActivity = activities.filter(activity => activity.taskId === task.task.id).at(-1)
  }
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
  const isProcessing = hasLiveThread || Boolean(planningThread?.executionMeta?.loopState === 'running')

  return {
    stage,
    planningState,
    hasSession: Boolean(plan || requestText || clarification || answeredClarification || activities.length || isProcessing),
    focus,
    requestText,
    requestTimestamp: requestMessage?.timestamp,
    answeredClarification,
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
    isProcessing,
    review: plan ? projectPlanReview(plan) : undefined,
  }
}
