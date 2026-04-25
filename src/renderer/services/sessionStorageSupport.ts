import {
  fromPersistedChatThread,
  type ChatThread,
  type PersistedChatThread,
} from '@/renderer/agent/types'

export interface SessionIndexMeta {
  currentThreadId: string | null
  threadIds: string[]
  version: number
}

export interface SessionExtraState {
  branches: Record<string, unknown>
  activeBranchId: Record<string, string | null>
}

export interface SessionMeta extends SessionIndexMeta {
  extra: SessionExtraState
}

export interface AgentSessionSnapshot {
  threads: Record<string, ChatThread>
  currentThreadId: string | null
  branches: Record<string, unknown>
  activeBranchId: Record<string, unknown>
  version: number
}

export interface PersistedThreadSummary {
  id: string
  title?: string
  lastModified: number
  messageCount: number
}

export interface SessionCatalog {
  meta: SessionMeta
  summaries: PersistedThreadSummary[]
}

export interface LegacyAgentStoreEnvelope {
  state?: {
    threads?: Record<string, unknown>
    currentThreadId?: string | null
    branches?: Record<string, unknown>
    activeBranchId?: Record<string, unknown>
  }
  version?: number
}

export function serializeMessages(messages: unknown[]): string {
  if (messages.length === 0) return ''
  return messages.map(message => JSON.stringify(message)).join('\n')
}

export function parseMessagesFromJsonl(content: string, onInvalidLine?: (error: unknown) => void): unknown[] {
  if (!content.trim()) return []

  const messages: unknown[] = []
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      messages.push(JSON.parse(trimmed))
    } catch (error) {
      onInvalidLine?.(error)
    }
  }
  return messages
}

export const DEFAULT_SESSION_META: SessionMeta = {
  currentThreadId: null,
  threadIds: [],
  extra: {
    branches: {},
    activeBranchId: {},
  },
  version: 0,
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeSessionExtraState(value?: Record<string, unknown> | null): SessionExtraState {
  const rawBranches = isPlainRecord(value?.branches) ? value.branches : {}
  const rawActiveBranchId = isPlainRecord(value?.activeBranchId) ? value.activeBranchId : {}

  const activeBranchId: Record<string, string | null> = {}
  for (const [threadId, branchId] of Object.entries(rawActiveBranchId)) {
    if (typeof branchId === 'string' || branchId === null) {
      activeBranchId[threadId] = branchId
    }
  }

  return {
    branches: { ...rawBranches },
    activeBranchId,
  }
}

export function serializeSessionExtraState(extra: SessionExtraState): Record<string, unknown> {
  const serialized: Record<string, unknown> = {}

  if (Object.keys(extra.branches).length > 0) {
    serialized.branches = extra.branches
  }

  if (Object.keys(extra.activeBranchId).length > 0) {
    serialized.activeBranchId = extra.activeBranchId
  }

  return serialized
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(',')}}`
}

export function toSessionIndexMeta(meta: SessionMeta): SessionIndexMeta {
  return {
    currentThreadId: meta.currentThreadId,
    threadIds: meta.threadIds,
    version: meta.version,
  }
}

export function normalizePersistedChatThread(thread: PersistedChatThread): PersistedChatThread {
  const messages = Array.isArray(thread.messages) ? thread.messages : []
  const preservedMessageCount =
    typeof thread.messageCount === 'number'
      ? thread.messageCount
      : messages.length

  return {
    ...thread,
    title: typeof thread.title === 'string' ? thread.title : undefined,
    messages,
    contextItems: Array.isArray(thread.contextItems) ? thread.contextItems : [],
    messageCheckpoints: Array.isArray(thread.messageCheckpoints) ? thread.messageCheckpoints : [],
    messageCount: preservedMessageCount,
    contextSummary: thread.contextSummary ?? null,
    handoffResume: isPlainRecord(thread.handoffResume) &&
      typeof thread.handoffResume.sourceThreadId === 'string' &&
      typeof thread.handoffResume.createdAt === 'number'
      ? {
        sourceThreadId: thread.handoffResume.sourceThreadId,
        createdAt: thread.handoffResume.createdAt,
      }
      : undefined,
  }
}

export function stripThreadMessagesForMetadata(thread: PersistedChatThread): PersistedChatThread {
  return normalizePersistedChatThread({
    ...thread,
    messageCount: typeof thread.messageCount === 'number'
      ? thread.messageCount
      : (Array.isArray(thread.messages) ? thread.messages.length : 0),
    messages: [],
  })
}

export function normalizeLegacyThreadRecord(threadId: string, value: unknown): ChatThread | null {
  if (!isPlainRecord(value)) {
    return null
  }

  const messages = Array.isArray(value.messages) ? value.messages : []
  const contextItems = Array.isArray(value.contextItems) ? value.contextItems : []
  const messageCheckpoints = Array.isArray(value.messageCheckpoints) ? value.messageCheckpoints : []
  const createdAt = typeof value.createdAt === 'number' ? value.createdAt : Date.now()
  const lastModified = typeof value.lastModified === 'number' ? value.lastModified : createdAt

  return fromPersistedChatThread({
    id: typeof value.id === 'string' ? value.id : threadId,
    createdAt,
    lastModified,
    title: typeof value.title === 'string' ? value.title : undefined,
    messages,
    contextItems,
    messageCheckpoints,
    messageCount: typeof value.messageCount === 'number' ? value.messageCount : messages.length,
    contextSummary: null,
    todos: Array.isArray(value.todos) ? value.todos : undefined,
    handoffContext: typeof value.handoffContext === 'string' ? value.handoffContext : undefined,
    handoffResume: isPlainRecord(value.handoffResume) &&
      typeof value.handoffResume.sourceThreadId === 'string' &&
      typeof value.handoffResume.createdAt === 'number'
      ? {
        sourceThreadId: value.handoffResume.sourceThreadId,
        createdAt: value.handoffResume.createdAt,
      }
      : undefined,
    pendingObjective: typeof value.pendingObjective === 'string' ? value.pendingObjective : undefined,
    pendingSteps: Array.isArray(value.pendingSteps) ? value.pendingSteps.filter((step): step is string => typeof step === 'string') : undefined,
    mode: value.mode as PersistedChatThread['mode'],
    origin: value.origin === 'plan-task' ? 'plan-task' : value.origin === 'user' ? 'user' : undefined,
    planId: typeof value.planId === 'string' ? value.planId : undefined,
    taskId: typeof value.taskId === 'string' ? value.taskId : undefined,
  })
}

export function selectPreferredCurrentThreadId(
  currentThreadId: string | null,
  summaries: PersistedThreadSummary[],
  preferNonEmptyThread: boolean
): string | null {
  if (summaries.length === 0) return null

  const summaryById = new Map(summaries.map(summary => [summary.id, summary]))
  const sorted = [...summaries].sort((left, right) => {
    const leftHasMessages = left.messageCount > 0 ? 1 : 0
    const rightHasMessages = right.messageCount > 0 ? 1 : 0
    if (rightHasMessages !== leftHasMessages) {
      return rightHasMessages - leftHasMessages
    }
    if (right.messageCount !== left.messageCount) {
      return right.messageCount - left.messageCount
    }
    return right.lastModified - left.lastModified
  })

  if (currentThreadId) {
    const currentSummary = summaryById.get(currentThreadId)
    if (currentSummary) {
      if (!preferNonEmptyThread || currentSummary.messageCount > 0 || sorted[0]?.messageCount === 0) {
        return currentThreadId
      }
    }
  }

  return sorted[0]?.id || null
}

export function buildEffectiveSessionMeta(
  meta: SessionMeta,
  summaries: PersistedThreadSummary[]
): SessionMeta {
  if (summaries.length === 0) {
    return meta.threadIds.length === 0 && !meta.currentThreadId
      ? meta
      : { ...DEFAULT_SESSION_META, extra: meta.extra }
  }

  const hasNonEmptyThread = summaries.some(summary => summary.messageCount > 0)
  const effectiveSummaries = hasNonEmptyThread
    ? summaries.filter(summary => summary.messageCount > 0)
    : summaries
  const actualThreadIds = effectiveSummaries.map(summary => summary.id).sort()
  const preferredCurrentThreadId = selectPreferredCurrentThreadId(
    meta.currentThreadId,
    effectiveSummaries,
    hasNonEmptyThread
  )

  return {
    currentThreadId: preferredCurrentThreadId,
    threadIds: actualThreadIds,
    extra: meta.extra,
    version: meta.version,
  }
}
