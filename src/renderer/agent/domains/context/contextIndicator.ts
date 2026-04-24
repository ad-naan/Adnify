import type { ChatThread } from '../../types'

export type ContextIndicatorKind =
  | 'usage'
  | 'compressing'
  | 'handoff_ready'
  | 'switching'
  | 'switched'

function hasReadyHandoff(thread: ChatThread): boolean {
  return thread.handoff.status === 'ready' && !!thread.handoff.document
}

function hasResumedFromHandoff(thread: ChatThread): boolean {
  return Boolean(thread.handoffContext)
}

function isCompressionActive(thread: ChatThread): boolean {
  return thread.isCompacting || (thread.compressionPhase !== 'idle' && thread.compressionPhase !== 'done')
}

export function resolveContextIndicatorKind(thread: ChatThread | null | undefined): ContextIndicatorKind {
  if (!thread) return 'usage'

  if (thread.handoff.status === 'transitioning') {
    return 'switching'
  }

  if (isCompressionActive(thread)) {
    return 'compressing'
  }

  if (hasReadyHandoff(thread)) {
    return 'handoff_ready'
  }

  if (hasResumedFromHandoff(thread)) {
    return 'switched'
  }

  return 'usage'
}
