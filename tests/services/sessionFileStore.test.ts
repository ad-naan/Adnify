import { beforeEach, describe, expect, it, vi } from 'vitest'

const fileApi = vi.hoisted(() => ({
  readDir: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  exists: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('@/renderer/services/electronAPI', () => ({ api: { file: fileApi } }))
vi.mock('@utils/Logger', () => ({
  logger: { system: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}))

import { SessionFileStore } from '@/renderer/services/sessionFileStore'

function createStore() {
  return new SessionFileStore({
    getSessionsDirPath: () => 'C:/workspace/.adnify/sessions',
    getSessionFilePath: name => `C:/workspace/.adnify/sessions/${name}`,
    getThreadMetaPath: id => `C:/workspace/.adnify/sessions/${id}.json`,
    getThreadMessagesPath: id => `C:/workspace/.adnify/sessions/${id}.jsonl`,
  })
}

describe('SessionFileStore I/O coordination', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shares concurrent reads of the same session file', async () => {
    let resolveRead!: (value: string) => void
    fileApi.read.mockImplementation(() => new Promise<string>(resolve => { resolveRead = resolve }))
    const store = createStore()

    const first = store.readSessionFile('_meta.json')
    const second = store.readSessionFile('_meta.json')
    expect(fileApi.read).toHaveBeenCalledTimes(1)

    resolveRead('{"version":1}')
    await expect(Promise.all([first, second])).resolves.toEqual([{ version: 1 }, { version: 1 }])
  })

  it('shares catalog scans and limits metadata reads to four at a time', async () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({
      name: `thread-${index}.json`,
      isDirectory: false,
    }))
    fileApi.readDir.mockResolvedValue(entries)

    let activeReads = 0
    let peakReads = 0
    fileApi.read.mockImplementation(async (filePath: string) => {
      activeReads += 1
      peakReads = Math.max(peakReads, activeReads)
      await new Promise(resolve => setTimeout(resolve, 2))
      activeReads -= 1
      const id = /thread-(\d+)/.exec(filePath)?.[1] ?? '0'
      return JSON.stringify({ id: `thread-${id}`, title: `Thread ${id}`, lastModified: 1, messageCount: 0 })
    })

    const store = createStore()
    const [first, second] = await Promise.all([
      store.listPersistedThreadSummaries(),
      store.listPersistedThreadSummaries(),
    ])

    expect(fileApi.readDir).toHaveBeenCalledTimes(1)
    expect(fileApi.read).toHaveBeenCalledTimes(12)
    expect(peakReads).toBeLessThanOrEqual(4)
    expect(first).toEqual(second)
  })

  it('serializes writes targeting the same session file', async () => {
    const resolvers: Array<(value: boolean) => void> = []
    fileApi.write.mockImplementation(() => new Promise<boolean>(resolve => resolvers.push(resolve)))
    const store = createStore()

    const first = store.writeSessionFile('_meta.json', { version: 1 })
    const second = store.writeSessionFile('_meta.json', { version: 2 })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(fileApi.write).toHaveBeenCalledTimes(1)

    resolvers.shift()?.(true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(fileApi.write).toHaveBeenCalledTimes(2)

    resolvers.shift()?.(true)
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
  })
})
