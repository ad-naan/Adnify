import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '@renderer/store/slices/fileSlice'

const mocks = vi.hoisted(() => ({
  files: [] as OpenFile[],
  version: 1,
  onChanged: vi.fn(),
  readFull: vi.fn(),
  readTextChunk: vi.fn(),
  apply: vi.fn(),
  confirm: vi.fn(),
  consume: vi.fn(),
  unsubscribe: vi.fn(),
  markFileDeleted: vi.fn(),
  markFileRestored: vi.fn(),
  cleanup: undefined as (() => void) | undefined,
}))

vi.mock('react', () => ({ useEffect: (effect: () => () => void) => { mocks.cleanup = effect() } }))
vi.mock('@store', () => ({ useStore: { getState: () => ({
  openFiles: mocks.files,
  language: 'en',
  markFileDeleted: mocks.markFileDeleted,
  markFileRestored: mocks.markFileRestored,
}) } }))
vi.mock('@renderer/services/electronAPI', () => ({ api: { file: {
  onChanged: mocks.onChanged,
  readFull: mocks.readFull,
  readTextChunk: mocks.readTextChunk,
} } }))
vi.mock('@renderer/services/editorBufferService', () => ({
  applySavedEditorBufferContent: mocks.apply,
  getEditorBufferVersion: () => mocks.version,
}))
vi.mock('@renderer/services/internalWriteTracker', () => ({ internalWriteTracker: { consume: mocks.consume } }))
vi.mock('@renderer/components/common/ConfirmDialog', () => ({ globalConfirm: mocks.confirm }))

import { useFileWatcher } from '@renderer/hooks/useFileWatcher'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

describe('file watcher reload ordering', () => {
  let changed: (event: { event: string; path: string }) => Promise<void>
  const notify = (event = 'update') => changed({ event, path: 'D:/project/file.ts' })

  beforeEach(() => {
    mocks.cleanup?.()
    vi.resetAllMocks()
    mocks.version = 1
    mocks.files = [{ path: 'D:/project/file.ts', content: 'saved', contentState: 'loaded', contentLoadVersion: 1, isDirty: false, savedVersionId: 1 }]
    mocks.onChanged.mockImplementation(callback => { changed = callback; return mocks.unsubscribe })
    mocks.consume.mockReturnValue(false)
    mocks.confirm.mockResolvedValue(false)
    useFileWatcher()
  })

  it('asks before replacing edits made while the disk read was pending', async () => {
    const read = deferred<string>()
    mocks.readFull.mockReturnValue(read.promise)
    const pending = notify()
    mocks.files = [{ ...mocks.files[0], isDirty: true }]
    mocks.version++ // Monaco changed, but its store content snapshot has not arrived yet.
    read.resolve('external')
    await pending
    expect(mocks.confirm).toHaveBeenCalledOnce()
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('does not let an internal write overwrite edits made during its read', async () => {
    mocks.consume.mockReturnValue(true)
    const read = deferred<string>()
    mocks.readFull.mockReturnValue(read.promise)
    const pending = notify()
    mocks.version++
    read.resolve('agent edit')
    await pending
    expect(mocks.confirm).toHaveBeenCalledOnce()
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('ignores an older read that completes after a newer event', async () => {
    const old = deferred<string>()
    mocks.readFull.mockReturnValueOnce(old.promise).mockResolvedValueOnce('new disk content')
    const first = notify()
    await notify()
    old.resolve('old disk content')
    await first
    expect(mocks.apply.mock.calls).toEqual([['D:/project/file.ts', 'new disk content']])
  })

  it.each(['delete', 'unmount', 'reopen'] as const)('invalidates pending reads on %s', async action => {
    const read = deferred<string>()
    mocks.readFull.mockReturnValue(read.promise)
    const pending = notify()
    if (action === 'delete') await notify('delete')
    if (action === 'unmount') mocks.cleanup?.()
    if (action === 'reopen') mocks.files = [{ ...mocks.files[0], contentLoadVersion: 2 }]
    read.resolve('external')
    await pending
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('does not apply a confirmation to edits made after the dialog opened', async () => {
    mocks.files = [{ ...mocks.files[0], isDirty: true }]
    mocks.readFull.mockResolvedValue('external')
    const decision = deferred<boolean>()
    mocks.confirm.mockReturnValue(decision.promise)
    const pending = notify()
    await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    mocks.version++
    decision.resolve(true)
    await pending
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('reloads an unchanged buffer without a confirmation', async () => {
    mocks.readFull.mockResolvedValue('external')
    await notify()
    expect(mocks.apply).toHaveBeenCalledWith('D:/project/file.ts', 'external')
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('protects dirty buffers when a deleted file is recreated', async () => {
    mocks.files = [{ ...mocks.files[0], isDirty: true, isDeleted: true }]
    mocks.readFull.mockResolvedValue('recreated')
    await notify('create')
    expect(mocks.confirm).toHaveBeenCalledOnce()
    expect(mocks.apply).not.toHaveBeenCalled()
  })
})
