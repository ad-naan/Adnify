import type { TaskPlan, TaskStatus } from '@/renderer/agent/plan/types'
import type { Branch } from '@/renderer/agent/store/slices/branchSlice'
import type { ChatThread } from '@/renderer/agent/types'
import { getThreadDisplayTitle } from '@/renderer/agent/types'

export type TaskCenterStatus =
  | 'running'
  | 'waiting'
  | 'handoff'
  | 'failed'
  | 'completed'
  | 'aborted'
  | 'idle'

export type TaskCenterRelation = 'root' | 'continuation' | 'subtask' | 'plan-task'

export interface TaskCenterNode {
  id: string
  threadId?: string
  title: string
  detail?: string
  relation: TaskCenterRelation
  status: TaskCenterStatus
  updatedAt: number
  branchCount: number
  messageCount: number
  depth: number
  children: TaskCenterNode[]
  dependencies?: string[]
}

export interface TaskCenterGroup {
  id: string
  kind: 'task' | 'plan'
  title: string
  status: TaskCenterStatus
  updatedAt: number
  nodes: TaskCenterNode[]
  progress?: { completed: number; total: number }
}

/** Plan owns its worker threads; the Agent task center must never surface them. */
export function isAgentTaskThread(thread: ChatThread): boolean {
  return thread.mode !== 'plan' && thread.origin !== 'plan-task'
}

const STATUS_WEIGHT: Record<TaskCenterStatus, number> = {
  waiting: 7,
  failed: 6,
  running: 5,
  handoff: 4,
  idle: 3,
  aborted: 2,
  completed: 1,
}

function strongestStatus(statuses: TaskCenterStatus[]): TaskCenterStatus {
  return statuses.reduce<TaskCenterStatus>(
    (strongest, status) => STATUS_WEIGHT[status] > STATUS_WEIGHT[strongest] ? status : strongest,
    'completed',
  )
}

export function deriveThreadTaskStatus(thread: ChatThread): TaskCenterStatus {
  const phase = thread.streamState?.phase
  const loop = thread.executionMeta?.loopState

  if (phase === 'tool_pending' || loop === 'waiting_for_user') return 'waiting'
  if (thread.handoff.status === 'transitioning') return 'handoff'
  if (phase === 'error' || loop === 'failed' || thread.handoff.status === 'failed') return 'failed'
  if (phase === 'streaming' || phase === 'tool_running' || loop === 'running' || loop === 'waiting_for_tools') return 'running'
  if (loop === 'completed') return 'completed'
  if (loop === 'aborted') return 'aborted'
  return 'idle'
}

function mapPlanTaskStatus(status: TaskStatus, waiting: boolean): TaskCenterStatus {
  if (waiting) return 'waiting'
  if (status === 'running') return 'running'
  if (status === 'failed') return 'failed'
  if (status === 'completed' || status === 'skipped') return 'completed'
  if (status === 'cancelled') return 'aborted'
  return 'idle'
}

function threadDetail(thread: ChatThread): string | undefined {
  if (thread.streamState?.currentToolCall?.name) return thread.streamState.currentToolCall.name
  if (thread.streamState?.statusText) return thread.streamState.statusText
  const activeTodo = thread.todos?.find(todo => todo.status === 'in_progress')
  if (activeTodo) return activeTodo.activeForm || activeTodo.content
  if (thread.pendingObjective) return thread.pendingObjective
  return undefined
}

function inferLegacyParents(threads: ChatThread[]): Map<string, string> {
  const result = new Map<string, string>()
  for (const parent of threads) {
    for (const message of parent.messages) {
      if (message.role !== 'assistant') continue
      for (const call of message.toolCalls || []) {
        const meta = call.arguments?._meta
        if (!meta || typeof meta !== 'object') continue
        const childId = (meta as Record<string, unknown>).subAgentThreadId
        if (typeof childId === 'string') result.set(childId, parent.id)
      }
    }
  }
  return result
}

function createThreadNode(
  thread: ChatThread,
  relation: TaskCenterRelation,
  depth: number,
  branches: Record<string, Branch[]>,
): TaskCenterNode {
  return {
    id: thread.id,
    threadId: thread.id,
    title: getThreadDisplayTitle(thread),
    detail: threadDetail(thread),
    relation,
    status: deriveThreadTaskStatus(thread),
    updatedAt: thread.lastModified,
    branchCount: (branches[thread.id] || []).filter(branch => branch.id !== '__mainline__').length,
    messageCount: thread.messageCount ?? thread.messages.length,
    depth,
    children: [],
  }
}

export function projectTaskCenter(
  threadMap: Record<string, ChatThread>,
  plans: TaskPlan[],
  branches: Record<string, Branch[]>,
): TaskCenterGroup[] {
  const threads = Object.values(threadMap)
  const threadById = new Map(threads.map(thread => [thread.id, thread]))
  const legacyParents = inferLegacyParents(threads)
  const claimedThreadIds = new Set<string>()
  const groups: TaskCenterGroup[] = []

  for (const plan of plans) {
    const planThreads = threads.filter(thread => thread.planId === plan.id)
    const originThread = plan.originThreadId ? threadById.get(plan.originThreadId) : undefined
    if (originThread) claimedThreadIds.add(originThread.id)
    planThreads.forEach(thread => claimedThreadIds.add(thread.id))

    const nodes = plan.tasks.map(task => {
      const thread = task.threadId ? threadById.get(task.threadId) : planThreads.find(item => item.taskId === task.id)
      const waiting = thread?.streamState?.phase === 'tool_pending' || thread?.executionMeta?.loopState === 'waiting_for_user'
      return {
        id: `plan-task:${plan.id}:${task.id}`,
        threadId: thread?.id,
        title: task.title,
        detail: thread ? threadDetail(thread) || task.description : task.description,
        relation: 'plan-task' as const,
        status: mapPlanTaskStatus(task.status, waiting),
        updatedAt: task.completedAt || task.startedAt || plan.updatedAt,
        branchCount: thread ? (branches[thread.id] || []).filter(branch => branch.id !== '__mainline__').length : 0,
        messageCount: thread ? (thread.messageCount ?? thread.messages.length) : 0,
        depth: 0,
        children: [],
        dependencies: task.dependencies,
      }
    })

    const completed = plan.tasks.filter(task => task.status === 'completed' || task.status === 'skipped').length
    groups.push({
      id: `plan:${plan.id}`,
      kind: 'plan',
      title: plan.name,
      status: strongestStatus(nodes.map(node => node.status)),
      updatedAt: plan.updatedAt,
      nodes,
      progress: { completed, total: plan.tasks.length },
    })
  }

  const standalone = threads.filter(thread => !claimedThreadIds.has(thread.id) && thread.origin !== 'plan-task')
  const standaloneIds = new Set(standalone.map(thread => thread.id))
  const parentById = new Map<string, string>()
  for (const thread of standalone) {
    const parentId = thread.parentThreadId || thread.handoffResume?.sourceThreadId || legacyParents.get(thread.id)
    if (parentId && standaloneIds.has(parentId)) parentById.set(thread.id, parentId)
  }

  const childrenByParent = new Map<string, ChatThread[]>()
  for (const thread of standalone) {
    const parentId = parentById.get(thread.id)
    if (!parentId) continue
    const siblings = childrenByParent.get(parentId) || []
    siblings.push(thread)
    childrenByParent.set(parentId, siblings)
  }

  const buildNode = (thread: ChatThread, depth: number): TaskCenterNode => {
    const parentId = parentById.get(thread.id)
    const relation: TaskCenterRelation = !parentId
      ? 'root'
      : thread.origin === 'handoff' || Boolean(thread.handoffResume)
        ? 'continuation'
        : 'subtask'
    const node = createThreadNode(thread, relation, depth, branches)
    node.children = (childrenByParent.get(thread.id) || [])
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(child => buildNode(child, depth + 1))
    return node
  }

  for (const root of standalone.filter(thread => !parentById.has(thread.id))) {
    const rootNode = buildNode(root, 0)
    const allNodes: TaskCenterNode[] = []
    const collect = (node: TaskCenterNode) => {
      allNodes.push(node)
      node.children.forEach(collect)
    }
    collect(rootNode)
    groups.push({
      id: `task:${root.id}`,
      kind: 'task',
      title: rootNode.title,
      status: strongestStatus(allNodes.map(node => node.status)),
      updatedAt: Math.max(...allNodes.map(node => node.updatedAt)),
      nodes: [rootNode],
    })
  }

  return groups.sort((a, b) => {
    const attentionDelta = STATUS_WEIGHT[b.status] - STATUS_WEIGHT[a.status]
    return attentionDelta || b.updatedAt - a.updatedAt
  })
}

export function flattenTaskNodes(nodes: TaskCenterNode[]): TaskCenterNode[] {
  const result: TaskCenterNode[] = []
  const visit = (node: TaskCenterNode) => {
    result.push(node)
    node.children.forEach(visit)
  }
  nodes.forEach(visit)
  return result
}
