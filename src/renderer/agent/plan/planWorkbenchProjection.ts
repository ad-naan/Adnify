import type { AssistantMessage, ChatMessage, ChatThread, InteractiveContent } from '@/renderer/agent/types'
import { getMessageText, isAssistantMessage } from '@/renderer/agent/types'
import type { PlanTask, TaskPlan } from './types'
import { PLAN_ACTIVITY_STAGES, PLAN_ACTIVITY_STATUSES, type PlanActivityStage, type PlanActivityStatus } from '@/shared/types/planActivity'
import { t, toLocaleTag, type Language, type TranslationKey } from '@shared/i18n'

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

/**
 * 计划评审风险。
 *
 * 带的是原因码 + 参数，不是文案：这份投影是数据层，语言在渲染层才知道。原来每条风险
 * 自带 `title`/`detail`/`titleZh`/`detailZh` 四个字段，视图再按语言挑一对 —— 加一种
 * 语言等于给结构体再加两个字段，并且投影层被迫拼用户可见的句子。
 */
export interface PlanReviewRisk {
  id: string
  severity: 'warning' | 'error'
  code: PlanReviewRiskCode
  /** 文案参数里的标量（数量、文件名） */
  params?: Record<string, string | number>
  /** 自由文本列表（任务标题），由渲染层按语言连接 */
  tasks?: string[]
}

export type PlanReviewRiskCode = 'dependencyCycle' | 'missingDependency' | 'parallelWriteConflict'

/** 风险文案的插值：标量原样带过去，自由文本列表按语言连接 */
export function planReviewRiskParams(risk: PlanReviewRisk, language: Language): Record<string, string | number> {
  if (!risk.tasks) return risk.params || {}
  return { ...risk.params, tasks: new Intl.ListFormat(toLocaleTag(language)).format(risk.tasks) }
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

/**
 * Per-thread scan caches, keyed by the message array's identity.
 *
 * The workbench re-projects on every store transition, and streaming replaces
 * `threads` (and the streaming thread's `messages`) roughly 30×/s. Without a
 * cache, each of those re-scanned every message of every plan/sub-agent thread —
 * measured at 3.5 ms per projection for 20 threads × 500 messages, i.e. ~107 ms
 * of CPU per second of streaming, growing with everything the plan accumulates.
 *
 * Only the thread that is actually streaming gets a new `messages` identity, so
 * keying on that reference lets every other thread reuse its previous scan.
 * A WeakMap means evicted threads are collected with their arrays.
 */
const threadScanCache = new WeakMap<readonly ChatMessage[], ThreadScan>()

interface ThreadScan {
  /** `report_plan_activity` payloads, in message order. */
  reported: { args: Record<string, unknown>; id: string; timestamp: number }[]
  /** Every other tool call, for the activity feed. */
  tools: { name: string; args: Record<string, unknown>; status: string; id: string; timestamp: number }[]
  /** `task` tool calls that spawned sub-agents. */
  subAgentCalls: { toolCall: ToolCallLike; meta: Record<string, unknown> }[]
  /** Last assistant message, so callers avoid `[...messages].reverse()`. */
  latestAssistant: AssistantMessage | undefined
}

interface ToolCallLike {
  id: string
  name: string
  status: string
  arguments: Record<string, unknown>
}

function readMeta(args: Record<string, unknown>): Record<string, unknown> {
  const meta = args._meta
  return meta && typeof meta === 'object' && !Array.isArray(meta)
    ? meta as Record<string, unknown>
    : {}
}

function findLast<T>(items: readonly T[], predicate: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return items[index]
  }
  return undefined
}

function scanThread(thread: ChatThread): ThreadScan {
  const messages = thread.messages
  const cached = threadScanCache.get(messages)
  if (cached) return cached

  const scan: ThreadScan = { reported: [], tools: [], subAgentCalls: [], latestAssistant: undefined }

  for (const message of messages) {
    if (!isAssistantMessage(message)) continue
    scan.latestAssistant = message

    // `toolCalls` and tool_call parts both carry calls; the reported-activity
    // feed has always read the union of the two.
    const partCalls = (message.parts || [])
      .filter(part => part.type === 'tool_call')
      .map(part => (part as { toolCall?: ToolCallLike }).toolCall)
    const allCalls = [...(message.toolCalls || []), ...partCalls]
      .filter((call): call is ToolCallLike => Boolean(call?.name))

    allCalls.forEach((toolCall, index) => {
      if (toolCall.name === 'report_plan_activity') {
        scan.reported.push({
          args: toolCall.arguments,
          id: `${thread.id}:${toolCall.id}`,
          timestamp: message.timestamp + index,
        })
      }
    })

    // The tool feed and sub-agent discovery only ever looked at `toolCalls`.
    ;(message.toolCalls || []).forEach((toolCall, index) => {
      if (toolCall.name === 'report_plan_activity') return
      scan.tools.push({
        name: toolCall.name,
        args: toolCall.arguments,
        status: toolCall.status,
        id: `${thread.id}:tool:${toolCall.id}`,
        timestamp: message.timestamp + index,
      })
      if (toolCall.name === 'task') {
        scan.subAgentCalls.push({
          toolCall: toolCall as ToolCallLike,
          meta: readMeta(toolCall.arguments),
        })
      }
    })
  }

  threadScanCache.set(messages, scan)
  return scan
}

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

/** 工具名 → 活动流里显示的标题；表里没有的工具退回到把下划线换成空格的工具名 */
const TOOL_TITLE_KEYS: Record<string, TranslationKey> = {
  ask_user: 'planWorkbench.tool.askUser',
  create_task_plan: 'planWorkbench.tool.createTaskPlan',
  read_file: 'planWorkbench.tool.readFile',
  read_files: 'planWorkbench.tool.readFile',
  search_files: 'planWorkbench.tool.searchFiles',
  list_directory: 'planWorkbench.tool.listDirectory',
  run_command: 'planWorkbench.tool.runCommand',
  task: 'planWorkbench.tool.task',
}

function toolDetail(args: Record<string, unknown>, language: Language): string | undefined {
  for (const key of ['description', 'question', 'path', 'filePath', 'command', 'prompt']) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 180)
  }
  for (const key of ['paths', 'files']) {
    const value = args[key]
    if (Array.isArray(value)) {
      // Intl.ListFormat 而不是写死的 '、'：中英文的列表连接符不一样，而这里连的是
      // 文件路径，顿号出现在英文界面里就是一眼乱码。用 narrow 是因为这是枚举而不是
      // 句子，不需要 “和 / and” 那个连词。
      return new Intl.ListFormat(toLocaleTag(language), { style: 'narrow' }).format(
        value.filter((item): item is string => typeof item === 'string').slice(0, 4),
      )
    }
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
    if (!thread) continue
    for (const { meta } of scanThread(thread).subAgentCalls) {
      const subAgentThreadId = meta.subAgentThreadId
      if (typeof subAgentThreadId === 'string') ids.add(subAgentThreadId)
    }
  }
  return Array.from(ids).map(id => threads[id]).filter(Boolean)
}

function projectSubAgents(thread: ChatThread | undefined, threads: Record<string, ChatThread>): PlanSubAgentRuntimeItem[] {
  if (!thread) return []
  return scanThread(thread).subAgentCalls.map(({ toolCall, meta: values }) => {
    const threadId = typeof values.subAgentThreadId === 'string' ? values.subAgentThreadId : undefined
    const child = threadId ? threads[threadId] : undefined
    const latestAssistant = child ? scanThread(child).latestAssistant : undefined
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
    return {
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
    }
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
  if (graph.hasCycle) risks.push({ id: 'dependency-cycle', severity: 'error', code: 'dependencyCycle' })
  if (graph.missingDependencies.length) {
    risks.push({
      id: 'missing-dependency',
      severity: 'error',
      code: 'missingDependency',
      params: { count: graph.missingDependencies.length },
    })
  }

  if (plan.executionMode === 'parallel') {
    const nodesByRank = new Map<number, PlanTask[]>()
    for (const node of graph.nodes) nodesByRank.set(node.rank, [...(nodesByRank.get(node.rank) || []), node.task])
    for (const [rank, rankedTasks] of nodesByRank) {
      const writers = new Map<string, string[]>()
      for (const task of rankedTasks) for (const file of task.producesFiles || []) writers.set(file, [...(writers.get(file) || []), task.title])
      for (const [file, taskTitles] of writers) {
        if (taskTitles.length < 2) continue
        risks.push({
          id: `write-conflict:${rank}:${file}`,
          severity: 'warning',
          code: 'parallelWriteConflict',
          params: { file },
          tasks: taskTitles,
        })
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
  language: Language
}): PlanWorkbenchProjection {
  const { plan, currentThreadId, threads, language } = input
  const planningThread = getPlanningThread(plan, currentThreadId, threads)
  const planningMessages = planningThread?.messages || []
  const planningState = derivePlanPlanningState(planningMessages)
  const relevantThreads = getRelevantThreads(plan, currentThreadId, threads)

  const reportedActivities = relevantThreads
    .flatMap(thread => scanThread(thread).reported)
    .flatMap(entry => {
      const item = toActivity(entry.args, entry.id, entry.timestamp)
      return item ? [item] : []
    })
    .sort((a, b) => a.timestamp - b.timestamp)

  const tasks: PlanTaskRuntimeItem[] = (plan?.tasks || []).map(task => {
    const thread = task.threadId ? threads[task.threadId] : undefined
    const latestAssistant = thread ? scanThread(thread).latestAssistant : undefined
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

  // Reverse-scan in place: `[...planningMessages].reverse()` copied the whole
  // history twice per projection just to read the last matching entry.
  const clarificationMessage = findLast(planningMessages, message =>
    isAssistantMessage(message) && Boolean(message.interactive) && !message.interactive?.selectedIds?.length
  )
  const clarification = clarificationMessage && isAssistantMessage(clarificationMessage) && clarificationMessage.interactive
    ? { messageId: clarificationMessage.id, content: clarificationMessage.interactive }
    : undefined
  const answeredMessage = findLast(planningMessages, message =>
    isAssistantMessage(message) && Boolean(message.interactive?.selectedIds?.length)
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
  const toolActivities: PlanActivityItem[] = relevantThreads.flatMap(thread => {
    const taskId = taskIdByThread.get(thread.id)
    return scanThread(thread).tools.map(entry => ({
      id: entry.id,
      stage,
      title: TOOL_TITLE_KEYS[entry.name] ? t(TOOL_TITLE_KEYS[entry.name], language) : entry.name.replaceAll('_', ' '),
      detail: toolDetail(entry.args, language),
      status: toolStatus(entry.status),
      taskId,
      timestamp: entry.timestamp,
      source: 'tool',
    } satisfies PlanActivityItem))
  })
  const activities = [...reportedActivities, ...toolActivities].sort((a, b) => a.timestamp - b.timestamp)
  // One pass instead of a filter per task: `activities` is sorted, so the last
  // write per taskId wins, which is what `.filter(...).at(-1)` computed.
  const latestActivityByTask = new Map<string, PlanActivityItem>()
  for (const activity of activities) {
    if (activity.taskId) latestActivityByTask.set(activity.taskId, activity)
  }
  for (const task of tasks) {
    task.latestActivity = latestActivityByTask.get(task.task.id)
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
