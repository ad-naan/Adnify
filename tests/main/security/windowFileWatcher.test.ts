import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ setup: vi.fn(), cleanup: vi.fn(), gitDirectory: vi.fn() }))
vi.mock('@main/security/fileWatcher', () => ({ setupFileWatcher: mocks.setup, cleanupFileWatcher: mocks.cleanup }))
vi.mock('@main/services/gitMetadata', () => ({ resolveGitMetadataDirectory: mocks.gitDirectory }))
import { cleanupWindowFileWatchers, setWindowFileWatchers } from '@main/security/windowFileWatcher'

function sender(id: number) {
  return { id, send: vi.fn(), isDestroyed: vi.fn(() => false) } as unknown as Electron.WebContents
}

describe('window file watcher ownership', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.setup.mockResolvedValue(undefined)
    mocks.cleanup.mockResolvedValue(undefined)
    mocks.gitDirectory.mockResolvedValue(null)
    vi.useFakeTimers()
  })
  afterEach(async () => {
    await cleanupWindowFileWatchers()
    vi.useRealTimers()
  })

  it('subscribes every root and forwards changes from the second root', async () => {
    const window = sender(1)
    await setWindowFileWatchers(window, ['project/a', 'project/b'])
    expect(mocks.setup.mock.calls.map(call => call[1])).toEqual([path.resolve('project/a'), path.resolve('project/b')])
    const event = { event: 'update', path: path.resolve('project/b/file.ts') }
    mocks.setup.mock.calls[1][2](event)
    await vi.advanceTimersByTimeAsync(33)
    expect(window.send).toHaveBeenCalledWith('file:changed', event)
  })

  it('retains unchanged roots and cleans up only the removed root', async () => {
    const window = sender(1)
    await setWindowFileWatchers(window, ['project/a', 'project/b'])
    const removedId = mocks.setup.mock.calls[0][0]
    mocks.setup.mockClear()
    await setWindowFileWatchers(window, ['project/b', 'project/c'])
    expect(mocks.cleanup.mock.calls).toEqual([[removedId]])
    expect(mocks.setup.mock.calls.map(call => call[1])).toEqual([path.resolve('project/c')])
  })

  it('deduplicates roots and shared external Git metadata', async () => {
    const metadata = path.resolve('git-data/worktree')
    mocks.gitDirectory.mockResolvedValue(metadata)
    await setWindowFileWatchers(sender(1), ['project/a', 'project/a', 'project/b'])
    expect(mocks.setup).toHaveBeenCalledTimes(3)
    expect(mocks.setup.mock.calls.filter(call => call[1] === metadata)).toHaveLength(1)
    expect(mocks.setup.mock.calls.find(call => call[1] === metadata)?.[3]).toEqual({ forwardOnly: true })
  })

  it('does not stop another window watching the same root', async () => {
    await setWindowFileWatchers(sender(1), ['project/a'])
    await setWindowFileWatchers(sender(2), ['project/a'])
    const firstId = mocks.setup.mock.calls[0][0]
    const secondId = mocks.setup.mock.calls[1][0]
    expect(firstId).not.toBe(secondId)
    await cleanupWindowFileWatchers(1)
    expect(mocks.cleanup.mock.calls).toEqual([[firstId]])
  })

  it('cleans a subscription that finishes after the window closes', async () => {
    let finish!: () => void
    mocks.setup.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const watching = setWindowFileWatchers(sender(1), ['project/a', 'project/b'])
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const closing = cleanupWindowFileWatchers(1)
    finish()
    await Promise.all([watching, closing])
    expect(mocks.setup).toHaveBeenCalledOnce()
    expect(mocks.cleanup).toHaveBeenCalledWith(mocks.setup.mock.calls[0][0])
  })

  it('supersedes a pending workspace switch without leaving stale subscriptions', async () => {
    let finish!: () => void
    mocks.setup.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const window = sender(1)
    const first = setWindowFileWatchers(window, ['project/old', 'project/unused'])
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const second = setWindowFileWatchers(window, ['project/new'])
    finish()
    await Promise.all([first, second])
    expect(mocks.setup.mock.calls.map(call => call[1])).toEqual([path.resolve('project/old'), path.resolve('project/new')])
    expect(mocks.cleanup).toHaveBeenCalledWith(mocks.setup.mock.calls[0][0])
  })

  it('clears queued events and all subscriptions when no roots remain', async () => {
    const window = sender(1)
    await setWindowFileWatchers(window, ['project/a'])
    mocks.setup.mock.calls[0][2]({ event: 'update', path: 'project/a/file.ts' })
    await setWindowFileWatchers(window, [])
    await vi.runAllTimersAsync()
    expect(window.send).not.toHaveBeenCalled()
    expect(mocks.cleanup).toHaveBeenCalledOnce()
  })
})
