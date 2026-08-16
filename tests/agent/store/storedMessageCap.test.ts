import { describe, expect, it, beforeEach, vi } from 'vitest'

vi.mock('@services/agentSessionRepository', () => ({
  agentSessionRepository: {
    deleteThread: vi.fn(() => Promise.resolve()),
    stageSnapshot: vi.fn(),
    flush: vi.fn(() => Promise.resolve()),
    clear: vi.fn(() => Promise.resolve()),
  },
}))

import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { getAgentConfig } from '@/renderer/agent/utils/AgentConfig'
import type { ChatMessage } from '@/renderer/agent/types'

/**
 * Stored history was unbounded: only thread COUNT was capped (50), so one long
 * session grew its `<id>.jsonl` forever — and that file is rewritten in full on
 * every dirty flush, so persistence cost scaled with history length.
 *
 * The trim must never orphan a `tool` message from the `assistant` message whose
 * `tool_calls` reference it, because many providers reject that outright.
 */
describe('stored message history cap', () => {
  beforeEach(() => {
    useAgentStore.setState({
      threads: {},
      currentThreadId: null,
      threadMessageVersions: {},
      branches: {},
      activeBranchId: {},
    })
  })

  function seed(threadId: string, messages: ChatMessage[]) {
    useAgentStore.setState(state => ({
      threads: {
        ...state.threads,
        [threadId]: { ...state.threads[threadId], messages },
      },
    }))
  }

  it('caps stored messages at the configured limit', () => {
    const store = useAgentStore.getState()
    const threadId = store.createThread({ activate: true, mode: 'agent', origin: 'user' })
    const limit = getAgentConfig().maxStoredMessagesPerThread

    // Alternate user/assistant so there is always a safe user cut point.
    const history: ChatMessage[] = Array.from({ length: limit + 200 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg ${i}`,
      timestamp: i,
      ...(i % 2 === 1 ? { parts: [], toolCalls: [] } : {}),
    })) as ChatMessage[]
    seed(threadId, history)

    useAgentStore.getState().prepareExecution('next turn', [])

    const stored = useAgentStore.getState().threads[threadId].messages
    expect(stored.length).toBeLessThanOrEqual(limit + 2)
    // Newest content is what survives.
    expect(stored.at(-1)?.role).toBe('assistant')
  })

  it('never leaves a tool result without its originating assistant message', () => {
    const store = useAgentStore.getState()
    const threadId = store.createThread({ activate: true, mode: 'agent', origin: 'user' })
    const limit = getAgentConfig().maxStoredMessagesPerThread

    // Long run of assistant+tool pairs with no user messages near the cut point.
    const history: ChatMessage[] = []
    for (let i = 0; i < limit + 100; i++) {
      history.push({
        id: `a${i}`,
        role: 'assistant',
        content: '',
        timestamp: i * 2,
        parts: [],
        toolCalls: [{ id: `tc${i}`, name: 'read_file', arguments: {}, status: 'success' }],
      } as unknown as ChatMessage)
      history.push({
        id: `t${i}`,
        role: 'tool',
        content: 'ok',
        timestamp: i * 2 + 1,
        toolCallId: `tc${i}`,
        name: 'read_file',
      } as unknown as ChatMessage)
    }
    seed(threadId, history)

    useAgentStore.getState().prepareExecution('next turn', [])

    const stored = useAgentStore.getState().threads[threadId].messages
    const toolCallIds = new Set(
      stored.flatMap(m =>
        m.role === 'assistant'
          ? ((m as { toolCalls?: Array<{ id: string }> }).toolCalls || []).map(tc => tc.id)
          : []
      )
    )
    for (const msg of stored) {
      if (msg.role !== 'tool') continue
      const id = (msg as unknown as { toolCallId: string }).toolCallId
      expect(toolCallIds.has(id)).toBe(true)
    }
  })

  it('leaves short threads untouched', () => {
    const store = useAgentStore.getState()
    const threadId = store.createThread({ activate: true, mode: 'agent', origin: 'user' })

    useAgentStore.getState().prepareExecution('first', [])
    useAgentStore.getState().prepareExecution('second', [])

    // 2 turns => 4 messages, far below the cap.
    expect(useAgentStore.getState().threads[threadId].messages).toHaveLength(4)
  })
})
