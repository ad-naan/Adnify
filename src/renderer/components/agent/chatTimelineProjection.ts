import {
  isAssistantMessage,
  isUserMessage,
  isContextSnapshotPart,
  type ChatMessage as ChatMessageType,
  type ToolCall,
} from '@/renderer/agent/types'

export interface TimelineArchiveItem {
  kind: 'archive'
  key: string
  hiddenCount: number
  revealCount: number
  remainingCount: number
}

export interface TimelineMessageItem<T> {
  kind: 'message'
  key: string
  item: T
}

export type ChatTimelineItem<T> = TimelineArchiveItem | TimelineMessageItem<T>

export interface ChatTimelineProjectionOptions {
  expandedHistoryCount?: number
  visibleTailCount?: number
  revealBatchSize?: number
}

export interface ChatTimelineProjectionResult {
  hiddenCount: number
  revealCount: number
  visibleMessages: ChatMessageType[]
}

const DEFAULT_VISIBLE_TAIL_COUNT = 100
const DEFAULT_REVEAL_BATCH_SIZE = 50
const ACTIVE_TOOL_STATUSES = new Set<ToolCall['status']>(['pending', 'awaiting', 'running'])

function hasActiveToolCall(message: ChatMessageType): boolean {
  return isAssistantMessage(message) && (message.toolCalls?.some(toolCall => ACTIVE_TOOL_STATUSES.has(toolCall.status)) ?? false)
}

function isContextSnapshotOnlyMessage(message: ChatMessageType): boolean {
  return isAssistantMessage(message) &&
    message.parts.length > 0 &&
    message.parts.every(isContextSnapshotPart)
}

function getActiveTailStartIndex(messages: ChatMessageType[]): number {
  let activeTailStart = messages.length

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    const isActiveAssistant = isAssistantMessage(message) && (message.isStreaming || hasActiveToolCall(message))

    if (!isActiveAssistant) {
      continue
    }

    activeTailStart = index
    if (index > 0 && isUserMessage(messages[index - 1])) {
      activeTailStart = index - 1
    }
  }

  return activeTailStart
}

export function buildChatTimelineProjection(
  messages: ChatMessageType[],
  options: ChatTimelineProjectionOptions = {}
): ChatTimelineProjectionResult {
  const {
    expandedHistoryCount = 0,
    visibleTailCount = DEFAULT_VISIBLE_TAIL_COUNT,
    revealBatchSize = DEFAULT_REVEAL_BATCH_SIZE,
  } = options

  if (messages.length === 0) {
    return {
      hiddenCount: 0,
      revealCount: 0,
      visibleMessages: [],
    }
  }

  const baseVisibleStart = Math.max(0, messages.length - visibleTailCount)
  const activeTailStart = getActiveTailStartIndex(messages)
  const recentVisibleStart = Math.min(baseVisibleStart, activeTailStart)
  const visibleStart = Math.max(0, recentVisibleStart - Math.max(0, expandedHistoryCount))
  const hiddenMessages = messages.slice(0, visibleStart)
  const visibleSnapshotMessages = hiddenMessages.filter(isContextSnapshotOnlyMessage)
  const hiddenCount = hiddenMessages.length - visibleSnapshotMessages.length

  return {
    hiddenCount,
    revealCount: Math.min(revealBatchSize, hiddenCount),
    visibleMessages: [
      ...visibleSnapshotMessages,
      ...messages.slice(visibleStart),
    ],
  }
}
