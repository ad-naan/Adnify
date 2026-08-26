import type { LLMMessage } from '@shared/types'
import type { ThreadBoundStore } from '../store/AgentStore'

type ToolCardCleanupStore = Pick<
  ThreadBoundStore,
  'getMessages' | 'updateMessage' | 'clearToolStreamingPreview'
>

export function clearUnexecutedToolCards(
  threadStore: ToolCardCleanupStore,
  assistantId: string | undefined,
  toolCallsToClear?: Array<{ id: string }>,
): void {
  if (!assistantId) return

  const assistantMessage = threadStore.getMessages().find(message => message.id === assistantId)
  if (assistantMessage?.role !== 'assistant') return

  const cancelledIds = new Set((toolCallsToClear || []).map(toolCall => toolCall.id).filter(Boolean))
  if (cancelledIds.size === 0) return

  threadStore.updateMessage(assistantId, {
    parts: assistantMessage.parts.filter(part =>
      part.type !== 'tool_call' || !cancelledIds.has(part.toolCall.id)
    ),
    toolCalls: (assistantMessage.toolCalls || []).filter(toolCall =>
      !cancelledIds.has(toolCall.id)
    ),
  })

  for (const toolCallId of cancelledIds) {
    threadStore.clearToolStreamingPreview(toolCallId)
  }
}

export function prepareLLMRequestMessages(
  messages: LLMMessage[],
  systemPrompt?: string,
): LLMMessage[] {
  return systemPrompt
    ? messages.filter(message => message.role !== 'system')
    : messages
}
