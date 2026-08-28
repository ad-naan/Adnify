import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@services/agentSessionRepository', () => ({
  agentSessionRepository: {
    deleteThread: vi.fn(() => Promise.resolve()),
    stageSnapshot: vi.fn(),
    flush: vi.fn(() => Promise.resolve()),
    clear: vi.fn(() => Promise.resolve()),
  },
}))

import { Agent } from '@renderer/agent/core/Agent'
import { useAgentStore } from '@renderer/agent/store/AgentStore'

describe('Agent optimistic send', () => {
  beforeEach(() => {
    useAgentStore.setState({
      threads: {},
      currentThreadId: null,
      threadMessageVersions: {},
      branches: {},
      activeBranchId: {},
    })
  })

  it('commits the user message before asynchronous validation finishes', async () => {
    const promise = Agent.send(
      'visible immediately',
      { provider: 'openai', model: 'gpt-5', apiKey: '' } as never,
      null,
      'agent',
    )

    const thread = useAgentStore.getState().getCurrentThread()
    expect(thread?.messages.map(message => message.role)).toEqual(['user', 'assistant'])
    expect(thread?.messages[0].role === 'user' ? thread.messages[0].content : undefined)
      .toBe('visible immediately')

    await expect(promise).rejects.toThrow()

    const assistant = useAgentStore.getState().getCurrentThread()?.messages[1]
    expect(assistant?.role).toBe('assistant')
    expect(assistant && 'isStreaming' in assistant ? assistant.isStreaming : true).toBe(false)
  })
})
