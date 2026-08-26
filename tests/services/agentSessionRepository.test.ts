import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionCatalogRecord } from '@/shared/types/sessionPersistence'

const session = vi.hoisted(() => ({
  open: vi.fn(),
  loadMessages: vi.fn(),
  loadBranchMessages: vi.fn(),
  applyPatch: vi.fn(),
  clear: vi.fn(),
}))

vi.mock('@/renderer/services/electronAPI', () => ({ api: { session } }))
vi.mock('@utils/Logger', () => ({
  logger: { agent: { error: vi.fn() } },
}))

import { AgentSessionRepository } from '@/renderer/services/agentSessionRepository'

const catalog: SessionCatalogRecord = {
  state: { currentThreadId: 't1', activeBranchId: {}, version: 1 },
  threads: [{
    id: 't1',
    createdAt: 1,
    lastModified: 2,
    title: 'Thread',
    messageCount: 2,
    data: { contextItems: [], messageCheckpoints: [], contextSummary: null },
  }],
  branches: [],
}

describe('AgentSessionRepository incremental patches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    session.open.mockResolvedValue({ type: 'opened', catalog, migrated: false })
    session.applyPatch.mockResolvedValue(true)
    session.loadBranchMessages.mockResolvedValue([])
    session.clear.mockResolvedValue(true)
  })

  it('sends only the changed message tail with absolute ordinals', async () => {
    const repository = new AgentSessionRepository()
    const first = { id: 'm1', role: 'user', timestamp: 1, content: 'one' }
    const second = { id: 'm2', role: 'assistant', timestamp: 2, content: 'two' }
    session.loadMessages.mockResolvedValue([first, second])

    const snapshot = await repository.getSnapshot()
    await repository.loadThreadMessages('t1')
    const updatedSecond = { ...second, content: 'updated' }
    const thread = snapshot!.threads.t1
    repository.stageSnapshot({
      ...snapshot!,
      threadMessageVersions: { t1: 3 },
      threads: {
        t1: {
          ...thread,
          lastModified: 3,
          messages: [first, updatedSecond] as typeof thread.messages,
          messagesHydrated: true,
        },
      },
    })
    await repository.flush()

    expect(session.applyPatch).toHaveBeenCalledTimes(1)
    expect(session.applyPatch.mock.calls[0][0].threads[0]).toMatchObject({
      replaceFrom: 1,
      messages: [{ ordinal: 1, id: 'm2', payload: updatedSecond }],
    })
  })

  it('persists a changed live message reference even before its settled version advances', async () => {
    const repository = new AgentSessionRepository()
    const first = { id: 'm1', role: 'user', timestamp: 1, content: 'one' }
    const second = { id: 'm2', role: 'assistant', timestamp: 2, content: 'partial' }
    session.loadMessages.mockResolvedValue([first, second])

    const snapshot = await repository.getSnapshot()
    await repository.loadThreadMessages('t1')
    const thread = snapshot!.threads.t1
    const completedSecond = { ...second, content: 'partial response' }
    repository.stageSnapshot({
      ...snapshot!,
      // Streaming chunks intentionally keep this revision stable so the parent
      // timeline does not rebuild. A shutdown flush must still see the new
      // immutable message-array reference and persist its changed tail.
      threadMessageVersions: { t1: snapshot!.threadMessageVersions?.t1 || 0 },
      threads: {
        t1: {
          ...thread,
          messages: [first, completedSecond] as typeof thread.messages,
          messagesHydrated: true,
        },
      },
    })
    await repository.flush()

    expect(session.applyPatch).toHaveBeenCalledTimes(1)
    expect(session.applyPatch.mock.calls[0][0].threads[0]).toMatchObject({
      replaceFrom: 1,
      messages: [{ ordinal: 1, id: 'm2', payload: completedSecond }],
    })
  })

  // Dirty detection used to JSON.stringify each thread's metadata, which
  // transitively serialized every checkpoint's file contents on every persist.
  // It is now identity-based, so these two cases pin the behaviour it replaced:
  // a real checkpoint edit must still be written, and an untouched thread must
  // not be.
  it('detects a checkpoint change without serializing its payload', async () => {
    const repository = new AgentSessionRepository()
    session.loadMessages.mockResolvedValue([])

    const snapshot = await repository.getSnapshot()
    const thread = snapshot!.threads.t1
    const checkpoint = {
      id: 'cp1',
      messageId: 'm1',
      timestamp: 1,
      description: 'edit',
      fileSnapshots: { 'a.ts': { path: 'a.ts', content: 'before' } },
    }

    repository.stageSnapshot({
      ...snapshot!,
      threads: {
        t1: { ...thread, messageCheckpoints: [checkpoint] } as typeof thread,
      },
    })
    await repository.flush()
    expect(session.applyPatch).toHaveBeenCalledTimes(1)

    // Same checkpoint id, new content — writers always replace the containers.
    const edited = {
      ...checkpoint,
      fileSnapshots: { 'a.ts': { path: 'a.ts', content: 'after' } },
    }
    repository.stageSnapshot({
      ...snapshot!,
      threads: {
        t1: { ...thread, messageCheckpoints: [edited] } as typeof thread,
      },
    })
    await repository.flush()

    expect(session.applyPatch).toHaveBeenCalledTimes(2)
    expect(session.applyPatch.mock.calls[1][0].threads[0].metadata.data.messageCheckpoints)
      .toEqual([edited])
  })

  it('does not re-patch a thread whose metadata is unchanged', async () => {
    const repository = new AgentSessionRepository()
    session.loadMessages.mockResolvedValue([])

    const snapshot = await repository.getSnapshot()
    const thread = snapshot!.threads.t1

    // The first persist after load writes once: rehydration normalizes `mode`,
    // so the in-memory thread genuinely differs from what the catalog held.
    repository.stageSnapshot({ ...snapshot!, threads: { t1: thread } })
    await repository.flush()
    expect(session.applyPatch).toHaveBeenCalledTimes(1)

    // Staging the very same thread again must be recognized as a no-op.
    repository.stageSnapshot({ ...snapshot!, threads: { t1: thread } })
    await repository.flush()

    expect(session.applyPatch).toHaveBeenCalledTimes(1)
  })
})
