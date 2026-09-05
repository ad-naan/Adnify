import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExecutionService } from '@main/services/execution/ExecutionService'
import { ExecutionScheduler } from '@main/services/execution/ExecutionScheduler'
import { EXECUTION_LIMITS } from '@shared/types/execution'
import type { ProcessOutcome } from '@main/services/execution/ProcessRunner'

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
function setup() {
  const processes: Array<{ end: (result: ProcessOutcome) => void; output: (data: string) => void; stop: ReturnType<typeof vi.fn> }> = []
  const scheduler = new ExecutionScheduler({ ...EXECUTION_LIMITS, commands: 1 })
  const service = new ExecutionService(scheduler, () => {}, (_spec, output) => {
    let end!: (result: ProcessOutcome) => void
    const done = new Promise<ProcessOutcome>(resolve => { end = resolve })
    const stop = vi.fn()
    processes.push({ end, output, stop })
    return { done, stop, input: vi.fn() }
  })
  const spec = (key: string) => ({ requestKey: `${Date.now()}:${key}`, threadId: 'thread', command: 'test', cwd: '/workspace', shell: 'bash', mode: 'command' as const })
  return { service, processes, scheduler, spec }
}
afterEach(() => vi.useRealTimers())
describe('managed jobs', () => {
  it('deduplicates an accepted request and rejects mutation of its command', async () => {
    const { service, processes, spec } = setup()
    const request = spec('one')
    const first = service.submit(1, request)
    expect(service.submit(1, request).jobId).toBe(first.jobId)
    expect(() => service.submit(1, { ...request, command: 'different' })).toThrow('request_conflict')
    await flush()
    expect(processes).toHaveLength(1)
    processes[0].end({ exitCode: 0 }); await flush()
  })
  it('retains a stopping permit until actual process exit', async () => {
    const { service, processes, scheduler, spec } = setup()
    const first = service.submit(1, spec('one'))
    await flush()
    service.cancel(1, first.jobId)
    const second = service.submit(2, spec('two'))
    await flush()
    expect(service.get(1, first.jobId).status).toBe('stopping')
    expect(service.get(2, second.jobId).status).toBe('queued')
    expect(scheduler.usage().commands).toBe(1)
    processes[0].end({ exitCode: null, signal: 'SIGTERM' }); await flush()
    expect(service.get(1, first.jobId).status).toBe('cancelled')
    expect(processes).toHaveLength(2)
    processes[1].end({ exitCode: 0 }); await flush()
  })
  it('wait timeout neither cancels a job nor permits duplicate execution', async () => {
    vi.useFakeTimers()
    const { service, processes, scheduler, spec } = setup()
    const job = service.submit(1, spec('one')); await flush()
    const wait = service.wait(1, job.jobId, service.get(1, job.jobId).revision, 20)
    await vi.advanceTimersByTimeAsync(20)
    expect((await wait).status).toBe('running')
    expect(scheduler.usage().commands).toBe(1)
    expect(processes[0].stop).not.toHaveBeenCalled()
    processes[0].end({ exitCode: 0 }); await flush()
  })
  it('keeps unknown stop outcomes occupied and accepts a late exit', async () => {
    vi.useFakeTimers()
    const { service, processes, scheduler, spec } = setup()
    const job = service.submit(1, spec('one')); await flush()
    service.cancel(1, job.jobId)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(service.get(1, job.jobId).status).toBe('unknown')
    expect(scheduler.usage().commands).toBe(1)
    processes[0].end({ exitCode: 1 }); await flush()
    expect(scheduler.usage().commands).toBe(0)
  })
  it('tracks real background completion and preserves logs', async () => {
    const { service, processes, scheduler, spec } = setup()
    const job = service.submit(1, { ...spec('one'), mode: 'background' }); await flush()
    expect(service.get(1, job.jobId).endedAt).toBeUndefined()
    processes[0].output('server stopped\n')
    processes[0].end({ exitCode: 7 }); await flush()
    expect(service.get(1, job.jobId)).toMatchObject({ status: 'failed', exitCode: 7, output: 'server stopped\n' })
    expect(scheduler.usage().background).toBe(0)
  })
  it('isolates owners and only stops a closed window', async () => {
    const { service, processes, spec } = setup()
    const a = service.submit(1, { ...spec('one'), mode: 'background' })
    const b = service.submit(2, { ...spec('two'), mode: 'background' }); await flush()
    expect(() => service.cancel(2, a.jobId)).toThrow('job_not_found')
    service.closeOwner(1)
    expect(processes[0].stop).toHaveBeenCalledOnce()
    expect(processes[1].stop).not.toHaveBeenCalled()
    expect(service.get(2, b.jobId).status).toBe('running')
    processes.forEach(process => process.end({ exitCode: 0 })); await flush()
  })
  it('deduplicates a service and keeps retry aliases bound after it exits', async () => {
    const { service, processes, spec } = setup()
    const first = service.submit(1, { ...spec('one'), mode: 'background', serviceKey: 'dev' })
    const secondRequest = { ...spec('two'), mode: 'background' as const, serviceKey: 'dev' }
    expect(service.submit(1, secondRequest).jobId).toBe(first.jobId)
    await flush(); processes[0].end({ exitCode: 0 }); await flush()
    expect(service.submit(1, secondRequest).jobId).toBe(first.jobId)
    expect(processes).toHaveLength(1)
  })
  it('shares an explicitly identified workspace service and transfers ownership when a window closes', async () => {
    const { service, processes, scheduler, spec } = setup()
    const first = service.submit(1, { ...spec('one'), mode: 'background', serviceKey: 'dev', workspaceId: '/project' })
    const second = service.submit(2, { ...spec('two'), mode: 'background', serviceKey: 'dev', workspaceId: '/project' })
    expect(second.jobId).toBe(first.jobId)
    await flush()
    service.closeOwner(1)
    expect(processes[0].stop).not.toHaveBeenCalled()
    expect(service.get(2, second.jobId).status).toBe('running')
    expect(scheduler.usage(2).background).toBe(1)
    expect(scheduler.usage(1).background).toBe(0)
    service.closeOwner(2)
    expect(processes[0].stop).toHaveBeenCalledOnce()
    processes[0].end({ exitCode: 0 }); await flush()
  })
})
