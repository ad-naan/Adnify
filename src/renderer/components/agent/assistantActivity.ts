import type { AssistantPart } from '@renderer/agent/types'

/** Activity comes only from execution state, never text length or elapsed time. */
export function deriveAssistantActivity(parts: AssistantPart[], active: boolean) {
  const last = parts[parts.length - 1]
  const openPart = active ? [...parts].reverse().find(part =>
    ((part.type === 'reasoning' || part.type === 'search') && part.isStreaming)
    || (part.type === 'lint_check' && part.status === 'checking')) : undefined
  const activePart = active && last?.type === 'text' ? last : openPart
  const presentingToolIds = active ? parts.flatMap(part => part.type === 'tool_call'
    && ['pending', 'running', 'awaiting'].includes(part.toolCall.status) ? [part.toolCall.id] : []) : []
  return { activePart, openPart, presentingToolIds }
}
