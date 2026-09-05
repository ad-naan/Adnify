import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UtilityProcessClient, closeUtilityProcesses } from '@main/services/process/UtilityProcessClient'

const state = vi.hoisted(() => ({ children: [] as FakeChild[] }))
class FakeChild extends EventEmitter {
  pid: number | undefined
  postMessage = vi.fn()
  kill = vi.fn(() => true)
  spawn() { this.pid = 100 + state.children.indexOf(this); this.emit('spawn') }
  exit(code = 0) { this.pid = undefined; this.emit('exit', code) }
  reply(index: number, result: unknown) {
    this.emit('message', { requestId: this.postMessage.mock.calls[index][0].requestId, ok: true, result })
  }
}
vi.mock('electron', () => ({
  app: { isReady: () => true }, session: { defaultSession: {} },
  utilityProcess: { fork: () => { const child = new FakeChild(); state.children.push(child); return child } },
}))
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
const create = (extra: Partial<ConstructorParameters<typeof UtilityProcessClient>[0]> = {}) => new UtilityProcessClient({
  entry: 'fixture.js', name: 'Fixture', timeoutMs: 100, ...extra,
})
beforeEach(() => { state.children.length = 0; vi.useFakeTimers() })
afterEach(async () => {
  const closed = closeUtilityProcesses()
  state.children.forEach(child => child.exit())
  await closed
  vi.useRealTimers()
})

describe('utility RPC lifecycle', () => {
  it('starts lazily, shares a startup and matches out-of-order responses', async () => {
    const client = create()
    expect(state.children).toHaveLength(0)
    const first = client.request('first'), second = client.request('second')
    expect(state.children).toHaveLength(1)
    const child = state.children[0]
    child.spawn(); await flush()
    child.reply(1, 'second result'); child.reply(0, 'first result')
    expect(await first).toBe('first result')
    expect(await second).toBe('second result')
  })

  it('rejects all outstanding requests on an unexpected clean exit without replaying writes', async () => {
    const client = create()
    const first = client.request('write').catch(error => error), second = client.request('read').catch(error => error)
    const child = state.children[0]
    child.spawn(); await flush(); child.exit(0)
    expect(await first).toBeInstanceOf(Error)
    expect(await second).toBeInstanceOf(Error)
    expect(state.children).toHaveLength(1)
    const fresh = client.request('fresh')
    const replacement = state.children[1]
    replacement.spawn(); await flush(); replacement.reply(0, 'ok')
    expect(await fresh).toBe('ok')
    expect(replacement.postMessage.mock.calls.map(([message]) => message.operation)).toEqual(['fresh'])
  })

  it('kills a timed-out child once and never starts a second writer before exit', async () => {
    const onExit = vi.fn()
    const client = create({ onExit })
    const request = client.request('slow write').catch(error => error)
    const child = state.children[0]
    child.spawn(); await flush()
    await vi.advanceTimersByTimeAsync(100)
    expect(((await request) as Error).message).toContain('timed out')
    expect(child.kill).toHaveBeenCalledTimes(1)
    const duringExit = client.request('new write').catch(error => error)
    expect(state.children).toHaveLength(1)
    child.exit(1)
    expect(await duringExit).toBeInstanceOf(Error)
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('cancels startup requests on close and kills a late-spawning child', async () => {
    const client = create()
    const request = client.request('write').catch(error => error)
    const child = state.children[0]
    const closing = client.close()
    child.spawn(); await flush(); child.exit()
    await closing
    expect(await request).toBeInstanceOf(Error)
    expect(child.postMessage).not.toHaveBeenCalled()
    await expect(client.request('later')).rejects.toThrow('closed')
  })

  it('keeps callbacks associated with their request and ignores late results after a crash', async () => {
    let resolve!: (value: unknown) => void
    const onEvent = vi.fn(() => new Promise(done => { resolve = done }))
    const client = create()
    const request = client.request('document', { onEvent }).catch(error => error)
    const child = state.children[0]
    child.spawn(); await flush()
    const requestId = child.postMessage.mock.calls[0][0].requestId
    child.emit('message', { requestId, eventId: 'image', event: { data: 'fixture' } })
    await flush()
    expect(onEvent).toHaveBeenCalledWith({ data: 'fixture' })
    child.exit(1); resolve('description'); await flush()
    expect(child.postMessage).toHaveBeenCalledTimes(1)
    expect(await request).toBeInstanceOf(Error)
  })

  it('exits after idle time but retains the process while a new request is pending', async () => {
    const client = create({ idleMs: 50 })
    const first = client.request('read')
    const child = state.children[0]
    child.spawn(); await flush(); child.reply(0, 'ok'); await first
    await vi.advanceTimersByTimeAsync(40)
    const second = client.request('other')
    await flush(); await vi.advanceTimersByTimeAsync(40)
    expect(child.kill).not.toHaveBeenCalled()
    child.reply(1, 'done'); await second
    await vi.advanceTimersByTimeAsync(50)
    expect(child.kill).toHaveBeenCalledTimes(1)
  })
})
