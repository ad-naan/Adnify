import { describe, expect, it, beforeEach, vi } from 'vitest'

const repository = vi.hoisted(() => ({
  releaseThreadMessages: vi.fn(() => true),
  areThreadBranchesHydrated: vi.fn(() => true),
  loadThreadMessages: vi.fn(async () => []),
  loadThreadBranches: vi.fn(async () => []),
  deleteThread: vi.fn(async () => undefined),
}))

vi.mock('@/renderer/services/agentSessionRepository', () => ({
  agentSessionRepository: repository,
}))
vi.mock('@utils/Logger', () => ({
  logger: { agent: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}))

import { useAgentStore } from '@/renderer/agent/store/AgentStore'

function seedThread(id: string, messageCount: number, lastModified: number) {
  const messages = Array.from({ length: messageCount }, (_, index) => ({
    id: `${id}-m${index}`,
    role: 'user' as const,
    content: 'hello',
    timestamp: index,
  }))
  useAgentStore.setState(state => ({
    threads: {
      ...state.threads,
      [id]: {
        id,
        createdAt: 1,
        lastModified,
        messages,
        messagesHydrated: true,
        messageCount,
        contextItems: [],
        messageCheckpoints: [],
        contextSummary: null,
        streamState: { phase: 'idle' as const },
        toolStreamingPreviews: {},
        contextStats: null,
        compressionStats: null,
        handoff: { status: 'idle' as const, document: null },
        isCompacting: false,
        compressionPhase: 'idle' as const,
        executionMeta: { loopState: 'idle' as const },
      },
    },
  }))
}

describe('cold thread message unloading', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    repository.releaseThreadMessages.mockReturnValue(true)
    useAgentStore.setState({ threads: {}, currentThreadId: null, threadMessageVersions: {} })
  })

  it('keeps only the most recent threads hydrated when switching', () => {
    for (let i = 0; i < 10; i += 1) seedThread(`t${i}`, 5, i)
    useAgentStore.setState({ currentThreadId: 't0' })

    useAgentStore.getState().switchThread('t9')

    const threads = useAgentStore.getState().threads
    const hydrated = Object.values(threads).filter(t => t.messagesHydrated !== false)
    expect(hydrated).toHaveLength(6)
    // The switched-to thread and the newest others survive; the oldest are freed.
    expect(threads.t9.messagesHydrated).not.toBe(false)
    expect(threads.t0.messagesHydrated).toBe(false)
    expect(threads.t0.messages).toEqual([])
    // messageCount must survive so the sidebar can still show a count.
    expect(threads.t0.messageCount).toBe(5)
  })

  it('never unloads a thread that is still working', () => {
    for (let i = 0; i < 10; i += 1) seedThread(`t${i}`, 5, i)
    useAgentStore.setState(state => ({
      threads: {
        ...state.threads,
        t1: { ...state.threads.t1, executionMeta: { loopState: 'running' } },
        t2: { ...state.threads.t2, streamState: { phase: 'streaming' } },
      },
      currentThreadId: 't0',
    }))

    useAgentStore.getState().switchThread('t9')

    const threads = useAgentStore.getState().threads
    expect(threads.t1.messagesHydrated).not.toBe(false)
    expect(threads.t1.messages).toHaveLength(5)
    expect(threads.t2.messagesHydrated).not.toBe(false)
    expect(threads.t2.messages).toHaveLength(5)
  })

  it('leaves messages in memory when the repository refuses to release them', () => {
    for (let i = 0; i < 10; i += 1) seedThread(`t${i}`, 5, i)
    useAgentStore.setState({ currentThreadId: 't0' })
    // An uncommitted patch is the only copy of those writes.
    repository.releaseThreadMessages.mockReturnValue(false)

    useAgentStore.getState().switchThread('t9')

    const threads = useAgentStore.getState().threads
    expect(Object.values(threads).every(t => t.messagesHydrated !== false)).toBe(true)
  })
})
