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
})
