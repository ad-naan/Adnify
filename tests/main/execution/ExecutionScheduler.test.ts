import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExecutionScheduler } from '@main/services/execution/ExecutionScheduler'
import { EXECUTION_LIMITS } from '@shared/types/execution'

afterEach(() => vi.useRealTimers())
describe('execution admission', () => {
  it('rotates windows instead of draining one window first', async () => {
    const scheduler = new ExecutionScheduler({ ...EXECUTION_LIMITS, commands: 1 })
    const running = await scheduler.acquire({ ownerId: 1, threadId: 'a', pool: 'command' })
    let aStarted = false
    const a = scheduler.acquire({ ownerId: 1, threadId: 'b', pool: 'command' }).then(release => { aStarted = true; return release })
    const b = scheduler.acquire({ ownerId: 2, threadId: 'c', pool: 'command' })
    running()
    const releaseB = await b
    expect(aStarted).toBe(false)
    releaseB()
    ;(await a)()
    expect(scheduler.usage().commands).toBe(0)
  })
  it('keeps background and ordinary command budgets independent', async () => {
    const scheduler = new ExecutionScheduler({ ...EXECUTION_LIMITS, background: 1, persistent: 1 })
    const background = await scheduler.acquire({ ownerId: 1, threadId: 'a', pool: 'background' })
    const command = await scheduler.acquire({ ownerId: 2, threadId: 'b', pool: 'command' })
    expect(scheduler.usage()).toMatchObject({ commands: 1, background: 1 })
    background(); command()
  })
  it('atomically reserves the last slot and never dispatches a cancelled waiter', async () => {
    const scheduler = new ExecutionScheduler({ ...EXECUTION_LIMITS, commands: 1 })
    const first = scheduler.acquire({ ownerId: 1, threadId: 'a', pool: 'command' })
    const abort = new AbortController()
    const second = scheduler.acquire({ ownerId: 2, threadId: 'a', pool: 'command' }, abort.signal)
    const rejected = expect(second).rejects.toMatchObject({ code: 'cancelled' })
    abort.abort()
    await rejected
    ;(await first)()
    expect(scheduler.usage()).toMatchObject({ commands: 0, queued: 0 })
  })
  it('expires queued work without consuming or leaking capacity', async () => {
    vi.useFakeTimers()
    const scheduler = new ExecutionScheduler({ ...EXECUTION_LIMITS, commands: 1, queueTimeoutMs: 50 })
    const first = await scheduler.acquire({ ownerId: 1, threadId: 'a', pool: 'command' })
    const queued = scheduler.acquire({ ownerId: 2, threadId: 'b', pool: 'command' })
    const rejected = expect(queued).rejects.toMatchObject({ code: 'queue_expired' })
    await vi.advanceTimersByTimeAsync(50)
    await rejected
    first(); first()
    expect(scheduler.usage().commands).toBe(0)
  })
})
