import { useMemo } from 'react'
import type { AssistantPart } from '@renderer/agent/types'
import { projectAssistantTurn } from './assistantTurnProjection'
import { useDisclosureState } from '@renderer/hooks/useDisclosureState'
import { deriveAssistantActivity } from './assistantActivity'

/** Render the received parts directly. Only disclosure is local UI state. */
export function useAssistantTurnView({ parts, isTransportActive, isAwaitingApproval, hasContextMeta }: {
  parts: AssistantPart[]
  isTransportActive: boolean
  isAwaitingApproval: boolean
  hasContextMeta: boolean
}) {
  const active = isTransportActive || isAwaitingApproval
  const visibleParts = useMemo(() => active ? parts : parts.map(part =>
    (part.type === 'reasoning' || part.type === 'search') && part.isStreaming
      ? { ...part, isStreaming: false } : part), [parts, active])
  const projection = useMemo(() => projectAssistantTurn(visibleParts, { hasContextMeta }), [visibleParts, hasContextMeta])
  const { isOpen: processExpanded, toggle: toggleProcess } = useDisclosureState({ automaticOpen: active })
  return {
    visibleParts,
    processParts: new Set(projection.processParts),
    ...deriveAssistantActivity(visibleParts, active),
    processExpanded,
    toggleProcess,
    hasProcessContent: projection.hasProcessContent,
    summary: projection.summary,
  }
}
