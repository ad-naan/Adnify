import { describe, expect, it } from 'vitest'
import { getDojoMentorActivity } from '@/renderer/modes/dojo/dojoMentorActivity'
import type { AssistantMessage, UserMessage } from '@/renderer/agent/types'

const user = (id: string): UserMessage => ({ id, role: 'user', content: 'Question', timestamp: 1 })
const assistant = (id: string, content: string, toolName?: string): AssistantMessage => ({ id, role: 'assistant', content, parts: [], timestamp: 2, toolCalls: toolName ? [{ id: `${id}-tool`, name: toolName, arguments: { path: 'src/settings.ts' }, status: 'success' }] : [] })

describe('Dojo mentor live activity', () => {
  it('does not flash the previous response before the next turn starts streaming', () => {
    const result = getDojoMentorActivity({ messages: [user('old-question'), assistant('old-reply', 'Old reply', 'read_file'), user('new-question')], liveAssistantMessage: undefined })
    expect(result).toEqual({ items: [], content: '' })
  })
  it('shows all tools in the current turn, including earlier tool iterations', () => {
    const result = getDojoMentorActivity({ messages: [user('old-question'), assistant('old', 'Old', 'write_file'), user('new-question'), assistant('read', '', 'read_file'), assistant('search', 'Inspect the handler', 'find_symbol')], liveAssistantMessage: undefined })
    expect(result.items.map(item => item.text)).toEqual(['read_file · src/settings.ts', 'find_symbol · src/settings.ts'])
    expect(result.content).toBe('Inspect the handler')
  })
  it('uses the current live overlay and hides an unfinished plan JSON block', () => {
    const result = getDojoMentorActivity({ messages: [user('question'), assistant('reply', '')], liveAssistantMessage: assistant('reply', 'A focused plan\n```json\n{"steps":[') })
    expect(result.content).toBe('A focused plan')
  })
})
