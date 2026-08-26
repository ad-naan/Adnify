import type { AssistantPart } from '@/renderer/agent/types'

/**
 * Build the same identity-first, from-end fallback keys used by chat parts in
 * linear time. From-end fallback keys keep identical leading/trailing layouts
 * deterministic when a provider omits part ids.
 */
export function buildChatMessagePartKeys(parts: readonly AssistantPart[]): string[] {
  const keys = new Array<string>(parts.length)
  const typeCountsFromEnd = new Map<AssistantPart['type'], number>()

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    const sameTypeAfter = typeCountsFromEnd.get(part.type) ?? 0

    if ('id' in part && typeof part.id === 'string') {
      keys[index] = `${part.type}:${part.id}`
    } else if (part.type === 'tool_call') {
      keys[index] = `tool:${part.toolCall.id}`
    } else {
      keys[index] = `${part.type}:from-end-${sameTypeAfter}`
    }

    typeCountsFromEnd.set(part.type, sameTypeAfter + 1)
  }

  return keys
}
