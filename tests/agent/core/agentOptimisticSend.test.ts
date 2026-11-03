import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@services/agentSessionRepository', () => ({
  agentSessionRepository: {
    deleteThread: vi.fn(() => Promise.resolve()),
    stageSnapshot: vi.fn(),
    flush: vi.fn(() => Promise.resolve()),
    clear: vi.fn(() => Promise.resolve()),
  },
}))

import { ExecutionLaneCoordinator } from '@renderer/agent/orchestration/ExecutionLaneCoordinator'
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

  it('queues a second shared writer until the first releases its workspace', async () => {
    const store = useAgentStore.getState()
    const first = store.createThread()
    const second = store.createThread()
    const config = { provider: 'openai', model: 'gpt-5', apiKey: '' } as never
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const acquire = vi.spyOn(ExecutionLaneCoordinator, 'acquire').mockImplementation(async intent => {
      if (!intent.concurrent) await gate
      return { isolated: false, workspacePath: intent.workspacePath }
    })
    try {
      const a = Agent.send('first', config, '/repo', 'agent', {}, { threadId: first }).catch(() => 'ended')
      let secondEnded = false
      const b = Agent.send('second', config, '/repo', 'agent', {}, { threadId: second }).catch(() => { secondEnded = true })
      await vi.waitFor(() => expect(acquire).toHaveBeenCalledTimes(2))
      expect(acquire.mock.calls.map(([intent]) => intent.concurrent)).toEqual([false, true])
      expect(secondEnded).toBe(false)
      release()
      await Promise.all([a, b])
      expect(secondEnded).toBe(true)
    } finally { release(); acquire.mockRestore() }
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
