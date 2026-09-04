import { useMemo } from 'react'
import type { AssistantPart } from '@renderer/agent/types'
import { projectAssistantTurn } from './assistantTurnProjection'
import { useTurnFrame } from './ConversationPresentationProvider'
import { useDisclosureState } from '@renderer/hooks/useDisclosureState'

/** The controller owns playback; manual process disclosure remains a user choice. */
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
  const isPresenting = !!frame && frame.phase !== 'complete'
  // Like individual tool cards, the outer process follows the presentation
  // timeline. openWhile + autoClose:false left completed live turns expanded.
  const { isOpen: processExpanded, toggle: toggleProcess } = useDisclosureState({ automaticOpen: isPresenting })
  return {
    visibleParts,
    processParts,
    activePart,
    openPart,
    isPresenting,
    processExpanded,
    toggleProcess,
    hasProcessContent: projection.hasProcessContent,
    presentingToolIds: openPart?.type === 'tool_call' ? [openPart.toolCall.id] : [],
    summary: projection.summary,
  }
}
