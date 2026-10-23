import { materializeThreadMessages } from '@/renderer/agent/types'
import type { ChatThread } from '@/renderer/agent/types'

/** Show only the current turn, never the previous reply while a new request prepares. */
export function getDojoMentorActivity(thread: Pick<ChatThread, 'messages' | 'liveAssistantMessage'> | undefined) {
  const messages = thread ? materializeThreadMessages(thread) : []
  let start = messages.length
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === 'user') { start = index + 1; break }
  }
  const items: Array<{ id: string; text: string; state: string }> = []
  let content = ''
  for (const message of messages.slice(start)) {
    if (message.role !== 'assistant') continue
    for (const call of message.toolCalls ?? []) {
      const args = call.arguments ?? {}
      const target = args.path ?? args.relative_path ?? args.name_path ?? args.query ?? args.pattern ?? args.url
      items.push({ id: call.id, text: `${call.name}${typeof target === 'string' ? ` · ${target}` : ''}`, state: call.status })
    }
    content = (message.displayContent || message.content || '').replace(/```(?:json)?\s*\{[\s\S]*$/, '').trim()
  }
  return { items: items.slice(-8), content }
}
