import { afterEach, describe, expect, it, vi } from 'vitest'
import { destroyIndexService, getIndexService } from '@main/indexing/indexProcess'

const state = vi.hoisted(() => ({ clients: [] as Array<{ request: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }> }))
vi.mock('electron', () => ({ BrowserWindow: {} }))
vi.mock('@main/services/configPath', () => ({ getUserConfigDir: () => 'fixture', getWorkspaceCacheDir: () => 'fixture/cache' }))
vi.mock('@main/services/process/UtilityProcessClient', () => ({ UtilityProcessClient: class {
  request = vi.fn(async () => ({ mode: 'structural' }))
  close = vi.fn(async () => {})
  constructor() { state.clients.push(this) }
} }))
afterEach(async () => { await destroyIndexService(); state.clients.length = 0 })

describe('index process workspace lifecycle', () => {
  it('gates repeated close/reopen cycles on the original database writer shutdown', async () => {
    const first = getIndexService('fixture/workspace')
    await first.initialize()
    let release!: () => void
    state.clients[0].close.mockImplementation(() => new Promise<void>(resolve => { release = resolve }))
    const closed = destroyIndexService('fixture/workspace')
    const second = getIndexService('fixture/workspace')
    const secondStart = second.initialize()
    const closedAgain = destroyIndexService('fixture/workspace')
    const third = getIndexService('fixture/workspace')
    const thirdStart = third.initialize()
    await Promise.resolve(); await Promise.resolve()
    expect(state.clients[1].request).not.toHaveBeenCalled()
    expect(state.clients[2].request).not.toHaveBeenCalled()
    release()
    await Promise.all([closed, closedAgain, secondStart, thirdStart])
    expect(state.clients[2].request).toHaveBeenCalledTimes(1)
  })
})
