import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExecutionService } from '@main/services/execution/ExecutionService'
import { ExecutionScheduler } from '@main/services/execution/ExecutionScheduler'
import { InteractiveSessionRegistry } from '@main/services/execution/InteractiveSessionRegistry'
import { IdleSessionReaper } from '@main/services/execution/IdleSessionReaper'
import { normalizeExecutionSettings } from '@shared/config/executionSettings'
import { cleanConfigValue } from '@shared/config/configCleaner'
import type { ProcessOutcome } from '@main/services/execution/ProcessRunner'

const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
afterEach(() => vi.useRealTimers())
describe('complete execution lifecycle', () => {
  it('normalizes persisted limits and preserves active reservations when a budget is lowered', async () => {
    const config = normalizeExecutionSettings({ commands: 2, commandsPerWindow: Infinity, background: -1, queuedPerThread: 9999, unknown: 1 })
    expect(config).toMatchObject({ commands: 2, commandsPerWindow: 2, background: 1, queuedPerThread: 32 })
    expect(cleanConfigValue('executionSettings', { commands: 2 })).toEqual(normalizeExecutionSettings({ commands: 2 }))
    const scheduler = new ExecutionScheduler(config)
    const first = await scheduler.acquire({ ownerId: 1, threadId: 'a', pool: 'command' })
    const second = await scheduler.acquire({ ownerId: 2, threadId: 'a', pool: 'command' })
    scheduler.configure(normalizeExecutionSettings({ commands: 1 }))
    let launched = false
    const next = scheduler.acquire({ ownerId: 3, threadId: 'b', pool: 'command', key: 'pending' }).then(release => { launched = true; return release })
    expect(scheduler.waitingReason('pending')).toBe('command_capacity')
    first(); await tick(); expect(launched).toBe(false)
    expect(scheduler.usage().commands).toBe(1)
    scheduler.configure(normalizeExecutionSettings({ commands: 2 }))
    const release = await next
    expect(launched).toBe(true)
    second(); release(); expect(scheduler.usage().commands).toBe(0)
  })
  it('hosts a service with no window consumers, then attaches and stops it from another window', async () => {
    let end!: (value: ProcessOutcome) => void
    const stop = vi.fn()
    const changed = vi.fn()
    const service = new ExecutionService(undefined, undefined, () => ({ done: new Promise(resolve => { end = resolve }), stop, input: vi.fn() }), undefined, changed)
    const request = { command: 'server', cwd: '/work', shell: 'bash', workspaceId: '/work', mode: 'background' as const,
      requestKey: `${Date.now()}:a`, threadId: 'a', serviceKey: 'dev' }
    const job = service.submit(1, request); await tick()
    service.setHosted(1, job.jobId, true)
    service.closeOwner(1)
    expect(stop).not.toHaveBeenCalled()
    expect(service.hosted()).toHaveLength(1)
    expect(service.hosted()[0].consumers).toBe(0)
    expect(() => service.cancel(2, job.jobId)).toThrow('job_not_found')
    const joined = service.submit(2, { ...request, requestKey: `${Date.now()}:b` })
    expect(joined.jobId).toBe(job.jobId)
    service.setHosted(2, job.jobId, false)
    expect(service.hosted()).toHaveLength(0)
    expect(changed).toHaveBeenCalled()
    service.closeOwner(2); expect(stop).toHaveBeenCalledOnce()
    expect(service.scheduler.usage().background).toBe(1)
    end({ exitCode: 0 }); await tick()
    expect(service.scheduler.usage().background).toBe(0)
  })
  it('keeps app shutdown authoritative even for a hosted service', async () => {
    let end!: (value: ProcessOutcome) => void
    const stop = vi.fn()
    const service = new ExecutionService(undefined, undefined, () => ({ done: new Promise(resolve => { end = resolve }), stop, input: vi.fn() }))
    const job = service.submit(1, { requestKey: `${Date.now()}:q`, threadId: 'q', command: 'server', cwd: '/work', workspaceId: '/work', shell: 'bash', mode: 'background' }); await tick()
    service.setHosted(1, job.jobId, true); service.closeOwner(1); service.shutdown()
    expect(stop).toHaveBeenCalledOnce()
    expect(service.hosted()[0].status).toBe('stopping')
    end({ exitCode: null }); await tick()
    expect(service.hosted()).toHaveLength(0)
  })
  it('expires unsubmitted leases without stopping a running command', async () => {
    vi.useFakeTimers()
    const registry = new InteractiveSessionRegistry()
    registry.add(1, { id: 'a', cwd: '/', shell: 'bash', isAgent: true })
    const first = registry.claim(1, 'a'), released = vi.fn()
    registry.attachPermit(1, 'a', first, released)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(released).toHaveBeenCalledOnce()
    expect(() => registry.input(1, 'a', first)).toThrow()
    const next = registry.claim(1, 'a'), running = vi.fn()
    registry.attachPermit(1, 'a', next, running); registry.input(1, 'a', next)
    await vi.advanceTimersByTimeAsync(60_000)
    registry.releaseUnsubmitted(1)
    expect(running).not.toHaveBeenCalled()
    registry.remove('a'); expect(running).toHaveBeenCalledOnce()
  })
  it('reclaims only explicitly disposable idle shells, with an atomic recheck after the child probe', async () => {
    vi.useFakeTimers()
    const registry = new InteractiveSessionRegistry()
    for (const id of ['retained', 'child', 'safe', 'race']) {
      registry.add(1, { id, cwd: '/', shell: 'bash', isAgent: true })
      registry.output(id, '\x1b]633;A\x07')
      if (id !== 'retained') registry.setDisposable(1, id, true)
    }
    const stopped: string[] = []
    const reaper = new IdleSessionReaper(registry, () => normalizeExecutionSettings({ idleGlobal: 0 }), async id => {
      if (id === 'race') registry.claim(1, id)
      return id !== 'child'
    }, id => stopped.push(id))
    await reaper.sweep()
    expect(stopped).toEqual(['safe'])
    expect(registry.list().find(row => row.id === 'safe')?.state).toBe('stopping')
    expect(registry.list().find(row => row.id === 'retained')?.state).toBe('ready')
  })
})
