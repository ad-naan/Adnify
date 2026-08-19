import { beforeEach, describe, expect, it, vi } from 'vitest'

const fileApi = vi.hoisted(() => ({
  readDir: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  exists: vi.fn(),
  delete: vi.fn(),
  copy: vi.fn(),
}))

vi.mock('@/renderer/services/electronAPI', () => ({ api: { file: fileApi } }))
vi.mock('@utils/Logger', () => ({
  logger: { system: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}))

import {
  SessionFileStore,
  SessionMessagesUnreadableError,
} from '@/renderer/services/sessionFileStore'

/**
 * Regression cover for the session data-destruction chain.
 *
 * A failed read used to surface as an empty message list, and an empty message
 * list is persisted by deleting the `.jsonl` — so one unreadable file turned
 * into permanent loss on the next flush.
 */

function createStore() {
  return new SessionFileStore({
    getSessionsDirPath: () => 'C:/workspace/.adnify/sessions',
    getSessionFilePath: name => `C:/workspace/.adnify/sessions/${name}`,
    getThreadMetaPath: id => `C:/workspace/.adnify/sessions/${id}.json`,
    getThreadMessagesPath: id => `C:/workspace/.adnify/sessions/${id}.jsonl`,
  })
}

describe('SessionFileStore message loading', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fileApi.copy.mockResolvedValue(true)
    fileApi.write.mockResolvedValue(true)
    fileApi.delete.mockResolvedValue(true)
  })

  it('treats a missing message file as a legitimately empty thread', async () => {
    fileApi.exists.mockResolvedValue(false)

    await expect(createStore().loadThreadMessages('t1')).resolves.toEqual([])
  })

  it('throws instead of reporting an empty history when the file cannot be read', async () => {
    fileApi.exists.mockResolvedValue(true)
    fileApi.read.mockResolvedValue(null)

    await expect(createStore().loadThreadMessages('t1'))
      .rejects.toThrow(SessionMessagesUnreadableError)
  })

  it('throws and preserves the payload when lines are damaged', async () => {
    fileApi.exists.mockImplementation(async (p: string) => !p.endsWith('.corrupt'))
    fileApi.read.mockResolvedValue(
      `${JSON.stringify({ id: 'a' })}\n{"id":"b"` // truncated tail line
    )

    await expect(createStore().loadThreadMessages('t1'))
      .rejects.toThrow(/invalid line/)

    expect(fileApi.copy).toHaveBeenCalledWith(
      'C:/workspace/.adnify/sessions/t1.jsonl',
      'C:/workspace/.adnify/sessions/t1.jsonl.corrupt'
    )
    // The original must survive untouched.
    expect(fileApi.delete).not.toHaveBeenCalled()
  })

  it('loads a clean file without quarantining it', async () => {
    fileApi.exists.mockResolvedValue(true)
    fileApi.read.mockResolvedValue(
      [JSON.stringify({ id: 'a' }), JSON.stringify({ id: 'b' })].join('\n')
    )

    await expect(createStore().loadThreadMessages('t1')).resolves.toEqual([
      { id: 'a' },
      { id: 'b' },
    ])
    expect(fileApi.copy).not.toHaveBeenCalled()
  })
})

describe('SessionFileStore write invariants', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fileApi.write.mockResolvedValue(true)
    fileApi.delete.mockResolvedValue(true)
    fileApi.exists.mockResolvedValue(true)
  })

  it('refuses to clear messages while metadata still reports a history', async () => {
    const store = createStore()

    await expect(
      store.writeSessionFile('t1.json', {
        id: 't1',
        createdAt: 1,
        lastModified: 2,
        messages: [],
        messageCount: 42,
      })
    ).rejects.toThrow(/Refusing to clear/)

    // Neither the messages nor the metadata may be committed.
    expect(fileApi.write).not.toHaveBeenCalled()
    expect(fileApi.delete).not.toHaveBeenCalled()
  })

  it('still deletes the message file for a thread that is genuinely empty', async () => {
    const store = createStore()

    await store.writeSessionFile('t1.json', {
      id: 't1',
      createdAt: 1,
      lastModified: 2,
      messages: [],
      messageCount: 0,
    })

    expect(fileApi.delete).toHaveBeenCalledWith('C:/workspace/.adnify/sessions/t1.jsonl')
  })

  it('writes messages before metadata so the count never leads the payload', async () => {
    const store = createStore()
    const order: string[] = []
    fileApi.write.mockImplementation(async (p: string) => {
      order.push(p.endsWith('.jsonl') ? 'messages' : 'metadata')
      return true
    })

    await store.writeSessionFile('t1.json', {
      id: 't1',
      createdAt: 1,
      lastModified: 2,
      messages: [{ id: 'a' }],
      messageCount: 1,
    })

    expect(order).toEqual(['messages', 'metadata'])
  })
})

describe('SessionFileStore summary scanning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks unreadable thread metadata instead of dropping the thread', async () => {
    fileApi.readDir.mockResolvedValue([
      { name: 'good.json', isDirectory: false },
      { name: 'bad.json', isDirectory: false },
    ])
    fileApi.read.mockImplementation(async (p: string) =>
      p.includes('good')
        ? JSON.stringify({ id: 'good', lastModified: 5, messageCount: 3 })
        : 'not json at all {'
    )

    const summaries = await createStore().listPersistedThreadSummaries()

    // Both ids survive: dropping `bad` would prune it from _meta.json.
    expect(summaries.map(s => s.id).sort()).toEqual(['bad', 'good'])
    expect(summaries.find(s => s.id === 'bad')?.unreadable).toBe(true)
    expect(summaries.find(s => s.id === 'good')?.unreadable).toBeUndefined()
  })
})
