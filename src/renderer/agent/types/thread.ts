/**
 * Thread and thread-scoped runtime state.
 */

import type { ToolCall, ToolStreamingPreview } from '@/shared/types'
import { normalizeMode } from '@/shared/types/workMode'
import type { AssistantMessage, ChatMessage } from './messages'
import { getMessageText } from './messages'
import type { MessageCheckpoint } from './checkpoint'
import type { ContextItem } from './context'
import type { HandoffDocument, StructuredSummary } from '../domains/context/types'
import type { CompressionStats } from '../core/types'

export interface ContextStats {
  totalChars: number
  maxChars: number
  fileCount: number
  maxFiles: number
  messageCount: number
  maxMessages: number
  semanticResultCount: number
  terminalChars: number
}

export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  /** Present-tense copy used by the UI for the active task label. */
  activeForm: string
}

export type StreamPhase = 'idle' | 'streaming' | 'tool_pending' | 'tool_running' | 'error'

/**
 * 三个「算不算在流式中」的谓词，回答的是**三个不同问题**，所以刻意保持三个。
 * 合并任意两个都会具体弄坏一处（下面每条都写了坏法），不要「统一」。
 *
 * `phase` 的写入方也分散：`startToolExecution` 会写 `'tool_running'`，而把它恢复成
 * `'streaming'` 的地方在 `core/tools.ts` 的 `executeToolCalls` 收尾处（工具批次全部结束、
 * 且 `!abortSignal?.aborted` 时）——这是整个子系统里最难发现的耦合。任何提前 return 掉
 * 那段恢复逻辑的改动都会让会话永久卡在 `tool_running`：停止按钮一直亮着、持久化一直暂停。
 */

/** 这一轮对话还在进行中 → 这条消息要显示活跃态（转圈、光标、工具卡片的运行样式）。 */
export const TURN_ACTIVE_PHASES: ReadonlySet<StreamPhase> = new Set<StreamPhase>([
    'streaming',
    'tool_running',
    'tool_pending',
])

/**
 * 请求真的在飞 → 显示停止按钮、暂停会话持久化。
 *
 * 不含 `tool_pending`：那是在等人做决定，可能等几分钟。把它算进来会让会话持久化
 * **无限期挂起**（AgentStore 的持久化早退分支）。
 */
export const REQUEST_IN_FLIGHT_PHASES: ReadonlySet<StreamPhase> = new Set<StreamPhase>([
    'streaming',
    'tool_running',
])

/**
 * 覆盖层（`thread.liveAssistantMessage`）此刻是权威的 → `selectMessageListState` 可以
 * 忽略 `messages` 引用变化、只认版本号。
 *
 * 只含 `'streaming'`：这是唯一有 token 每帧换引用的阶段。加进 `tool_running` 会**放宽
 * memo 的窗口**，让那些改了引用却不 bump 版本的写入更长时间不可见。
 */
export const OVERLAY_AUTHORITATIVE_PHASES: ReadonlySet<StreamPhase> = new Set<StreamPhase>([
    'streaming',
])

export type CompressionPhase = 'idle' | 'analyzing' | 'compressing' | 'summarizing' | 'done'
export type ThreadHandoffStatus = 'idle' | 'ready' | 'transitioning' | 'failed'

export interface ThreadHandoffState {
  status: ThreadHandoffStatus
  document: HandoffDocument | null
  source?: 'llm' | 'rule_based'
  createdAt?: number
  error?: string
}

export interface ThreadExecutionMeta {
  requestId?: string
  assistantId?: string
  /** 当前执行关联的 Plan 任务 ID，用于把线程执行态和任务实例绑定起来。 */
  planTaskId?: string
  loopState?: 'idle' | 'running' | 'waiting_for_tools' | 'waiting_for_user' | 'completed' | 'failed' | 'aborted'
}

export interface LaneNoticeState {
  type: 'warning' | 'info' | 'error'
  title: string
  message: string
  code?: string
}

/** Thread-local streaming state for the current agent run. */
export interface StreamState {
  phase: StreamPhase
  currentToolCall?: ToolCall
  /** Approval items from the current model turn that have not been decided yet. */
  pendingToolCalls?: ToolCall[]
  error?: string
  statusText?: string
  requestId?: string
  assistantId?: string
  laneNotice?: LaneNoticeState
}

export interface HandoffResumeMeta {
  sourceThreadId: string
  createdAt: number
}

export interface LastActiveServer {
  serverLinkId: string
  serverName: string
  host: string
  port?: number
  username?: string
  remotePath?: string
  updatedAt: number
}

/** Complete persisted thread record plus thread-scoped ephemeral preview state. */
export interface ChatThread {
  id: string
  createdAt: number
  lastModified: number
  title?: string

  messages: ChatMessage[]
  /**
   * Runtime-only overlay for the single assistant message currently streaming.
   * Keeping it outside `messages` makes token writes independent of history
   * length; persistence and execution boundaries materialize it atomically.
   */
  liveAssistantMessage?: AssistantMessage
  contextItems: ContextItem[]
  messageCheckpoints?: MessageCheckpoint[]
  /**
   * 消息总数（从磁盘元数据读取，用于懒加载线程的 UI 计数显示）
   * 当前线程实时值以 messages.length 为准；非当前线程用此字段
   */
  messageCount?: number
  /** Runtime-only flag: whether the full message body has been loaded into memory. */
  messagesHydrated?: boolean
  /**
   * Runtime-only flag: the last hydration attempt failed.
   *
   * Kept separate from `messagesHydrated` so the UI can leave its loading state
   * without claiming the thread is loaded — marking it hydrated would let the
   * persistence layer overwrite the on-disk messages with an empty list.
   */
  hydrationFailed?: boolean

  streamState: StreamState
  toolStreamingPreviews?: Record<string, ToolStreamingPreview>

  contextStats: ContextStats | null
  compressionStats: CompressionStats | null
  contextSummary: StructuredSummary | null
  handoff: ThreadHandoffState
  isCompacting: boolean
  compressionPhase: CompressionPhase

  todos?: TodoItem[]

  executionMeta?: ThreadExecutionMeta

  handoffContext?: string
  handoffResume?: HandoffResumeMeta
  pendingObjective?: string
  pendingSteps?: string[]
  lastActiveServer?: LastActiveServer

  // ===== Thread Ownership Metadata (Phase 3.1) =====
  /** Thread mode: chat/agent/plan */
  mode?: import('@/shared/types/workMode').WorkMode
  /** Thread origin controls how the task center classifies this execution node. */
  origin?: 'user' | 'plan-task' | 'sub-agent' | 'handoff'
  /** Associated plan ID (if origin is plan-task) */
  planId?: string
  /** Associated task ID (if origin is plan-task) */
  taskId?: string
  /** Parent execution node for sub-agents and handoff continuations. */
  parentThreadId?: string
  /** Stable top-level task lineage, even after several handoffs. */
  rootThreadId?: string
}

export interface PersistedChatThread {
  id: string
  createdAt: number
  lastModified: number
  title?: string
  messages: ChatMessage[]
  contextItems: ContextItem[]
  messageCheckpoints?: MessageCheckpoint[]
  messageCount?: number
  contextSummary: StructuredSummary | null
  todos?: TodoItem[]
  handoffContext?: string
  handoffResume?: HandoffResumeMeta
  pendingObjective?: string
  pendingSteps?: string[]
  lastActiveServer?: LastActiveServer
  mode?: import('@/shared/types/workMode').WorkMode
  origin?: 'user' | 'plan-task' | 'sub-agent' | 'handoff'
  planId?: string
  taskId?: string
  parentThreadId?: string
  rootThreadId?: string
}

export function materializeThreadMessages(
  thread: Pick<ChatThread, 'messages' | 'liveAssistantMessage'>
): ChatMessage[] {
  const liveMessage = thread.liveAssistantMessage
  if (!liveMessage) return thread.messages

  const messageIndex = thread.messages.findIndex(message => message.id === liveMessage.id)
  if (messageIndex === -1 || thread.messages[messageIndex] === liveMessage) {
    return thread.messages
  }

  const messages = thread.messages.slice()
  messages[messageIndex] = liveMessage
  return messages
}

export function createRuntimeThreadState(): Pick<
  ChatThread,
  'streamState' | 'toolStreamingPreviews' | 'contextStats' | 'compressionStats' | 'handoff' | 'isCompacting' | 'compressionPhase' | 'executionMeta'
> {
  return {
    streamState: { phase: 'idle' },
    toolStreamingPreviews: {},
    contextStats: null,
    compressionStats: null,
    handoff: createIdleHandoffState(),
    isCompacting: false,
    compressionPhase: 'idle',
    executionMeta: { loopState: 'idle' },
  }
}

export function createIdleHandoffState(): ThreadHandoffState {
  return {
    status: 'idle',
    document: null,
  }
}

export function toPersistedChatThread(thread: ChatThread): PersistedChatThread {
  return {
    id: thread.id,
    createdAt: thread.createdAt,
    lastModified: thread.lastModified,
    title: thread.title,
    messages: materializeThreadMessages(thread),
    contextItems: thread.contextItems,
    messageCheckpoints: thread.messageCheckpoints ?? [],
    messageCount: thread.messageCount,
    contextSummary: thread.contextSummary,
    todos: thread.todos,
    handoffContext: thread.handoffContext,
    handoffResume: thread.handoffResume,
    pendingObjective: thread.pendingObjective,
    pendingSteps: thread.pendingSteps,
    lastActiveServer: thread.lastActiveServer,
    mode: normalizeMode(thread.mode),
    origin: thread.origin,
    planId: thread.planId,
    taskId: thread.taskId,
    parentThreadId: thread.parentThreadId,
    rootThreadId: thread.rootThreadId,
  }
}

export function fromPersistedChatThread(thread: PersistedChatThread): ChatThread {
  const messages = thread.messages || []
  // A thread is considered hydrated if it has messages loaded in memory,
  // OR if the persisted messageCount indicates there are no messages on disk to load.
  // This prevents empty threads from being incorrectly marked as "not hydrated",
  // which would block their future state changes from being persisted.
  const persistedMessageCount = typeof thread.messageCount === 'number' ? thread.messageCount : messages.length
  const messagesHydrated = messages.length > 0 || persistedMessageCount === 0

  return {
    ...thread,
    mode: normalizeMode(thread.mode),
    messages,
    messagesHydrated,
    contextItems: thread.contextItems || [],
    messageCheckpoints: thread.messageCheckpoints || [],
    ...createRuntimeThreadState(),
  }
}

export function getThreadDisplayTitle(thread: Pick<ChatThread, 'title' | 'messages'>, fallback = 'New Chat'): string {
  const manualTitle = thread.title?.trim()
  if (manualTitle) {
    return manualTitle
  }

  const firstUserMessage = thread.messages.find(message => message.role === 'user')
  if (!firstUserMessage) {
    return fallback
  }

  const extractedTitle = getMessageText(firstUserMessage.content).trim().slice(0, 60)
  return extractedTitle || fallback
}
