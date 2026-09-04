import type { AssistantPart } from '@/renderer/agent/types'

/**
 * Intrinsic identity first, append-stable source position otherwise.
 * Counting from the end remounted every earlier text block when another arrived.
 */
export function buildChatMessagePartKeys(parts: readonly AssistantPart[]): string[] {
  const keys = new Array<string>(parts.length)
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]

    if ('id' in part && typeof part.id === 'string') {
      keys[index] = `${part.type}:${part.id}`
    } else if (part.type === 'tool_call') {
      keys[index] = `tool:${part.toolCall.id}`
    } else {
      keys[index] = `${part.type}:index-${index}`
    }

  }

  return keys
}
