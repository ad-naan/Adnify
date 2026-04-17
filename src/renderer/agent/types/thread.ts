/**
 * Thread and thread-scoped runtime state.
 */

import type { ToolCall, ToolStreamingPreview } from '@/shared/types'
import type { ChatMessage } from './messages'
import { getMessageText } from './messages'
import type { MessageCheckpoint } from './checkpoint'
import type { ContextItem } from './context'
import type { StructuredSummary } from '../domains/context/types'
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

export type CompressionPhase = 'idle' | 'analyzing' | 'compressing' | 'summarizing' | 'done'

export interface ThreadExecutionMeta {
  requestId?: string
  assistantId?: string
  /** 当前执行关联的 Plan 任务 ID，用于把线程执行态和任务实例绑定起来。 */
  planTaskId?: string
  loopState?: 'idle' | 'running' | 'waiting_for_tools' | 'waiting_for_user' | 'completed' | 'failed' | 'aborted'
}

/** Thread-local streaming state for the current agent run. */
export interface StreamState {
  phase: StreamPhase
  currentToolCall?: ToolCall
  error?: string
  statusText?: string
  requestId?: string
  assistantId?: string
}

/** Complete persisted thread record plus thread-scoped ephemeral preview state. */
export interface ChatThread {
  id: string
  createdAt: number
  lastModified: number
  title?: string

  messages: ChatMessage[]
  contextItems: ContextItem[]
  messageCheckpoints?: MessageCheckpoint[]
  /**
   * 消息总数（从磁盘元数据读取，用于懒加载线程的 UI 计数显示）
   * 当前线程实时值以 messages.length 为准；非当前线程用此字段
   */
  messageCount?: number
  /** Runtime-only flag: whether the full message body has been loaded into memory. */
  messagesHydrated?: boolean

  streamState: StreamState
  toolStreamingPreviews?: Record<string, ToolStreamingPreview>

  contextStats: ContextStats | null
  compressionStats: CompressionStats | null
  contextSummary: StructuredSummary | null
  handoffRequired: boolean
  isCompacting: boolean
  compressionPhase: CompressionPhase

  todos?: TodoItem[]

  executionMeta?: ThreadExecutionMeta

  handoffContext?: string
  pendingObjective?: string
  pendingSteps?: string[]

  // ===== Thread Ownership Metadata (Phase 3.1) =====
  /** Thread mode: chat/agent/plan */
  mode?: import('@/shared/types/workMode').WorkMode
  /** Thread origin: user-created or plan-task worker */
  origin?: 'user' | 'plan-task'
  /** Associated plan ID (if origin is plan-task) */
  planId?: string
  /** Associated task ID (if origin is plan-task) */
  taskId?: string
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
  pendingObjective?: string
  pendingSteps?: string[]
  mode?: import('@/shared/types/workMode').WorkMode
  origin?: 'user' | 'plan-task'
  planId?: string
  taskId?: string
}

export function createRuntimeThreadState(): Pick<
  ChatThread,
  'streamState' | 'toolStreamingPreviews' | 'contextStats' | 'compressionStats' | 'handoffRequired' | 'isCompacting' | 'compressionPhase' | 'executionMeta'
> {
  return {
    streamState: { phase: 'idle' },
    toolStreamingPreviews: {},
    contextStats: null,
    compressionStats: null,
    handoffRequired: false,
    isCompacting: false,
    compressionPhase: 'idle',
    executionMeta: { loopState: 'idle' },
  }
}

export function toPersistedChatThread(thread: ChatThread): PersistedChatThread {
  return {
    id: thread.id,
    createdAt: thread.createdAt,
    lastModified: thread.lastModified,
    title: thread.title,
    messages: thread.messages,
    contextItems: thread.contextItems,
    messageCheckpoints: thread.messageCheckpoints ?? [],
    messageCount: thread.messageCount,
    contextSummary: thread.contextSummary,
    todos: thread.todos,
    handoffContext: thread.handoffContext,
    pendingObjective: thread.pendingObjective,
    pendingSteps: thread.pendingSteps,
    mode: thread.mode,
    origin: thread.origin,
    planId: thread.planId,
    taskId: thread.taskId,
  }
}

export function fromPersistedChatThread(thread: PersistedChatThread): ChatThread {
  return {
    ...thread,
    messages: thread.messages || [],
    messagesHydrated: (thread.messages?.length || 0) > 0,
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
