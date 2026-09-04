import { describe, expect, it } from 'vitest'
import { deriveAssistantActivity } from '@renderer/components/agent/assistantActivity'
import type { AssistantPart } from '@renderer/agent/types'

describe('assistant execution activity', () => {
  it('does not show a completed reply as active, even with stale reasoning flags', () => {
    const parts: AssistantPart[] = [{ type: 'reasoning', id: 'thought', content: 'Received thought', isStreaming: true }, { type: 'text', content: 'Complete answer' }]
    expect(deriveAssistantActivity(parts, false)).toEqual({ activePart: undefined, openPart: undefined, presentingToolIds: [] })
  })

  it('marks only running or awaiting tools, without changing completed results', () => {
    const parts: AssistantPart[] = ['success', 'error', 'running', 'awaiting'].map((status, index) => ({ type: 'tool_call', toolCall: { id: String(index), name: 'browser_inspect', arguments: {}, status: status as 'success' | 'error' | 'running' | 'awaiting' } }))
    expect(deriveAssistantActivity(parts, true).presentingToolIds).toEqual(['2', '3'])
    expect(parts[0]).toMatchObject({ toolCall: { status: 'success' } })
  })

  it('uses the received text object directly for the active reply', () => {
    const answer: AssistantPart = { type: 'text', content: 'Already received '.repeat(500) }
    expect(deriveAssistantActivity([answer], true).activePart).toBe(answer)
    expect(deriveAssistantActivity([answer], false).activePart).toBeUndefined()
    expect(deriveAssistantActivity([answer], true).activePart).toBe(answer)
  })
})
