import { describe, expect, it, beforeEach, vi } from 'vitest'

const deleteThreadSpy = vi.fn((_id: string) => Promise.resolve())
const flushSpy = vi.fn(() => Promise.resolve())

vi.mock('@services/agentSessionRepository', () => ({
  agentSessionRepository: {
    deleteThread: (id: string) => deleteThreadSpy(id),
    stageSnapshot: vi.fn(),
    flush: () => flushSpy(),
    clear: vi.fn(async () => undefined),
  },
}))

import { useAgentStore } from '@/renderer/agent/store/AgentStore'

/**
 * Two storage-lifecycle bugs:
 *
 * 1. FIFO eviction in `createThread` dropped threads from the in-memory map
 *    without calling `agentSessionRepository.deleteThread`, orphaning each
 *    thread's `<id>.jsonl` and metadata on disk permanently. `deleteThread` has
 *    always cleaned up disk, so the two paths disagreed.
 *
 * 2. `clearMessages` left `branches[threadId]` intact. Branches store full
 *    copies of the conversation (including the synthetic `__mainline__`
 *    snapshot) and are persisted, so cleared content remained on disk and could
 *    be restored by switching branches.
 */
describe('thread storage lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAgentStore.setState({
      threads: {},
      currentThreadId: null,
      threadMessageVersions: {},
      branches: {},
      activeBranchId: {},
    })
  })

  it('deletes disk data for threads dropped by FIFO eviction', () => {
    const store = useAgentStore.getState()

    // MAX_THREADS is 50; the 51st creation must evict exactly one.
    const created: string[] = []
    for (let i = 0; i < 50; i++) {
      created.push(store.createThread({ activate: false, mode: 'agent', origin: 'user' }))
    }
    expect(Object.keys(useAgentStore.getState().threads)).toHaveLength(50)
    expect(deleteThreadSpy).not.toHaveBeenCalled()

    useAgentStore.getState().createThread({ activate: false, mode: 'agent', origin: 'user' })

    expect(Object.keys(useAgentStore.getState().threads)).toHaveLength(50)
    // The oldest thread was evicted AND its disk data removed.
    expect(deleteThreadSpy).toHaveBeenCalledTimes(1)
    expect(deleteThreadSpy).toHaveBeenCalledWith(created[0])
    expect(useAgentStore.getState().threads[created[0]]).toBeUndefined()
  })

  it('drops the message-version counter of an evicted thread', () => {
    const store = useAgentStore.getState()
    const created: string[] = []
    for (let i = 0; i < 50; i++) {
      created.push(store.createThread({ activate: false, mode: 'agent', origin: 'user' }))
    }
    useAgentStore.getState().createThread({ activate: false, mode: 'agent', origin: 'user' })

    const versions = useAgentStore.getState().threadMessageVersions
    expect(versions[created[0]]).toBeUndefined()
  })

  it('clearMessages removes the branch copies of the cleared conversation', () => {
    const store = useAgentStore.getState()
    const threadId = store.createThread({ activate: true, mode: 'agent', origin: 'user' })

    useAgentStore.getState().addUserMessage('hello')
    expect(useAgentStore.getState().threads[threadId].messages.length).toBeGreaterThan(0)

    // Simulate branch snapshots holding copies of that conversation.
    useAgentStore.setState(state => ({
      branches: { ...state.branches, [threadId]: [{ id: '__mainline__', messages: [] } as never] },
      activeBranchId: { ...state.activeBranchId, [threadId]: '__mainline__' },
    }))
    expect(useAgentStore.getState().branches[threadId]).toBeDefined()

    useAgentStore.getState().clearMessages(threadId)

    expect(useAgentStore.getState().threads[threadId].messages).toEqual([])
    expect(useAgentStore.getState().branches[threadId]).toBeUndefined()
    expect(useAgentStore.getState().activeBranchId[threadId]).toBeUndefined()
  })

  it('clearMessages persists immediately instead of waiting for a debounce', () => {
    const store = useAgentStore.getState()
    const threadId = store.createThread({ activate: true, mode: 'agent', origin: 'user' })
    useAgentStore.getState().addUserMessage('hello')

    flushSpy.mockClear()
    useAgentStore.getState().clearMessages(threadId)

    // persistCriticalAgentSessionState stages and flushes synchronously on call.
    expect(flushSpy).toHaveBeenCalled()
  })
})
