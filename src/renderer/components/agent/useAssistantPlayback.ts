import { useMemo } from 'react'
import type { AssistantPart } from '@renderer/agent/types'
import { projectAssistantTurn } from './assistantTurnProjection'
import { useTurnFrame } from './ConversationPresentationProvider'

/** Read-only projection. The conversation controller owns every playback decision. */
export function useAssistantPlayback({
  messageId, parts, isTransportActive, isAwaitingApproval, hasContextMeta,
}: {
  messageId: string
  parts: AssistantPart[]
  isTransportActive: boolean
  isAwaitingApproval: boolean
  hasContextMeta: boolean
}) {
  const frame = useTurnFrame(messageId)
  const sourceParts = frame?.sourceParts ?? parts
  const projection = useMemo(() => projectAssistantTurn(sourceParts, { hasContextMeta }), [sourceParts, hasContextMeta])
  // The provider's layout subscription initializes live turns before paint.
  const visibleParts = frame?.parts ?? (isTransportActive || isAwaitingApproval ? [] : parts)
  const processIndices = useMemo(() => {
    const processSources = new Set(projection.processParts)
    return new Set(sourceParts.flatMap((part, index) => processSources.has(part) ? [index] : []))
  }, [sourceParts, projection])
  const processParts = new Set(visibleParts.filter((_, index) => processIndices.has(index)))
  const activePart = frame && frame.activeIndex >= 0 ? visibleParts[frame.activeIndex] : undefined
  const openPart = frame && frame.openIndex >= 0 ? visibleParts[frame.openIndex] : undefined
  return {
    visibleParts,
    processParts,
    activePart,
    openPart,
    isPresenting: !!frame && frame.phase !== 'complete',
    hasProcessContent: projection.hasProcessContent,
    presentingToolIds: openPart?.type === 'tool_call' ? [openPart.toolCall.id] : [],
    summary: projection.summary,
  }
}
