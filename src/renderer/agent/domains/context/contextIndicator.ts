import { isAssistantMessage, isContextSnapshotPart, type ChatThread } from '../../types'

export type ContextIndicatorKind =
  | 'usage'
  | 'compressing'
  | 'handoff_ready'
  | 'switching'
  | 'switched'

export interface ContextIndicatorTransition {
  status: 'idle' | 'compressing' | 'switching'
  sourceThreadId?: string
  targetThreadId?: string
  startedAt?: number
}

const SWITCHING_STALE_MS = 10_000

function hasReadyHandoff(thread: ChatThread): boolean {
  return thread.handoff.status === 'ready' && !!thread.handoff.document && !isResumedFromHandoff(thread)
}

function hasHandoffSnapshotMessage(thread: ChatThread): boolean {
  return thread.messages.some(message =>
    isAssistantMessage(message) &&
    message.parts.some(part => isContextSnapshotPart(part) && part.snapshotKind === 'handoff'),
  )
}

function isHandoffSnapshotAssistantMessage(thread: ChatThread['messages'][number]): boolean {
  return (
    isAssistantMessage(thread) &&
    thread.parts.some(part => isContextSnapshotPart(part) && part.snapshotKind === 'handoff')
  )
}

function isResumedFromHandoff(thread: ChatThread): boolean {
  return Boolean(
    thread.handoffResume ||
    thread.handoffContext ||
    thread.pendingObjective ||
    (thread.pendingSteps && thread.pendingSteps.length > 0) ||
    hasHandoffSnapshotMessage(thread),
  )
}

function hasAssistantReplyAfterHandoff(thread: ChatThread): boolean {
  if (!isResumedFromHandoff(thread)) return false

  const handoffDigestIndex = thread.messages.findIndex(isHandoffSnapshotAssistantMessage)
  const postHandoffMessages = handoffDigestIndex >= 0
    ? thread.messages.slice(handoffDigestIndex + 1)
    : thread.messages

  return postHandoffMessages.some(message => isAssistantMessage(message) && !isHandoffSnapshotAssistantMessage(message))
}

function isCompressionActive(thread: ChatThread): boolean {
  return thread.isCompacting || (thread.compressionPhase !== 'idle' && thread.compressionPhase !== 'done')
}

function isSwitchingTransitionActive(
  transition: ContextIndicatorTransition | undefined,
  currentThreadId: string | null | undefined,
): boolean {
  if (transition?.status !== 'switching' || !currentThreadId) {
    return false
  }

  if (
    transition.sourceThreadId !== currentThreadId &&
    transition.targetThreadId !== currentThreadId
  ) {
    return false
  }

  if (!transition.startedAt) {
    return true
  }

  return Date.now() - transition.startedAt < SWITCHING_STALE_MS
}

export function resolveContextIndicatorKind(thread: ChatThread | null | undefined): ContextIndicatorKind {
  return resolveContextIndicatorKindForThread(thread)
}

export function resolveContextIndicatorKindForThread(
  thread: ChatThread | null | undefined,
  transition?: ContextIndicatorTransition,
  currentThreadId?: string | null,
): ContextIndicatorKind {
  if (!thread) return 'usage'

  if (isSwitchingTransitionActive(transition, currentThreadId)) {
    return 'switching'
  }

  if (
    transition?.status === 'compressing' &&
    currentThreadId &&
    transition.sourceThreadId === currentThreadId
  ) {
    return 'compressing'
  }

  if (thread.handoff.status === 'transitioning') {
    return 'switching'
  }

  if (isCompressionActive(thread)) {
    return 'compressing'
  }

  if (isResumedFromHandoff(thread) && !hasAssistantReplyAfterHandoff(thread)) {
    return 'switched'
  }

  if (hasReadyHandoff(thread)) {
    return 'handoff_ready'
  }

  return 'usage'
}
