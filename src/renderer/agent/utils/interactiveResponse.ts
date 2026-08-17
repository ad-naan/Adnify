import type { ChatThread, InteractiveContent } from '../types'

export interface InteractiveAnswer {
  selectedIds: string[]
  customText?: string
}

export function buildInteractiveResponse(
  content: InteractiveContent,
  answer: InteractiveAnswer,
): string {
  const customText = answer.customText?.trim()
  if (customText) return customText

  return content.options
    .filter(option => answer.selectedIds.includes(option.id))
    .map(option => option.label)
    .join(', ')
}

export function findThreadIdForMessage(
  threads: Record<string, ChatThread>,
  messageId: string,
): string | null {
  for (const [threadId, thread] of Object.entries(threads)) {
    if (thread.messages.some(message => message.id === messageId)) return threadId
  }
  return null
}
