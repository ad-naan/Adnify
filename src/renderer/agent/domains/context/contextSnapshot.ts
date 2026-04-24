import type { ChatThread } from '../../types'
import type { StructuredSummary } from './types'

export interface LatestContextSnapshot {
  source: 'summary' | 'handoff'
  summary: StructuredSummary
}

function computeLatestContextSnapshot(
  thread: Pick<ChatThread, 'contextSummary' | 'handoff'> | null | undefined,
): LatestContextSnapshot | null {
  if (!thread) return null

  const handoffSummary = thread.handoff.document?.summary
  const contextSummary = thread.contextSummary

  if (handoffSummary && (!contextSummary || handoffSummary.generatedAt >= contextSummary.generatedAt)) {
    return {
      source: 'handoff',
      summary: handoffSummary,
    }
  }

  if (contextSummary) {
    return {
      source: 'summary',
      summary: contextSummary,
    }
  }

  return null
}

export function getLatestContextSnapshot(
  thread: Pick<ChatThread, 'contextSummary' | 'handoff'> | null | undefined,
): LatestContextSnapshot | null {
  return computeLatestContextSnapshot(thread)
}

export function createLatestContextSnapshotSelector() {
  let lastThread: Pick<ChatThread, 'contextSummary' | 'handoff'> | null | undefined
  let lastContextSummary: StructuredSummary | null | undefined
  let lastHandoffSummary: StructuredSummary | undefined
  let lastResult: LatestContextSnapshot | null = null

  return (
    thread: Pick<ChatThread, 'contextSummary' | 'handoff'> | null | undefined,
  ): LatestContextSnapshot | null => {
    const contextSummary = thread?.contextSummary
    const handoffSummary = thread?.handoff.document?.summary

    if (
      thread === lastThread &&
      contextSummary === lastContextSummary &&
      handoffSummary === lastHandoffSummary
    ) {
      return lastResult
    }

    lastThread = thread
    lastContextSummary = contextSummary
    lastHandoffSummary = handoffSummary
    lastResult = computeLatestContextSnapshot(thread)
    return lastResult
  }
}
