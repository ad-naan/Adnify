import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { calculateWorkerPoolSize } from '@/renderer/services/workerPoolPolicy'
import { WorkerService } from '@/renderer/services/workerService'

const config = vi.hoisted(() => ({ timeout: 1000 }))
vi.mock('@renderer/settings', () => ({
  getEditorConfig: () => ({ performance: { workerTimeoutMs: config.timeout } }),
}))

describe('workerService resource usage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('caps the renderer-local worker pool at two workers', () => {
    expect(calculateWorkerPoolSize(1)).toBe(1)
    expect(calculateWorkerPoolSize(2)).toBe(1)
    expect(calculateWorkerPoolSize(4)).toBe(2)
    expect(calculateWorkerPoolSize(32)).toBe(2)
  })

  it('does not create workers until the service is used', () => {
    let created = 0
    let terminated = 0

    class MockWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null

      constructor() {
        created += 1
      }

      postMessage() {}

      terminate() {
        terminated += 1
      }
    }

    vi.stubGlobal('Worker', MockWorker)

    const workerService = new WorkerService(2)
    expect(created).toBe(0)

    workerService.init()
    expect(created).toBe(2)

    workerService.destroy()
    expect(terminated).toBe(2)
  })
})

describe('worker task cancellation', () => {
  const instances: MockWorker[] = []
  class MockWorker {
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    onmessageerror: (() => void) | null = null
    postMessage = vi.fn()
    terminate = vi.fn()
    constructor() { instances.push(this) }
    complete(result: unknown) {
      const request = this.postMessage.mock.calls.at(-1)![0]
      this.onmessage?.({ data: { id: request.id, success: true, result } } as MessageEvent)
    }
  }

  let service: WorkerService
  beforeEach(() => {
    instances.length = 0
    config.timeout = 1000
    vi.useFakeTimers()
    vi.stubGlobal('Worker', MockWorker)
    service = new WorkerService(1)
  })
  afterEach(() => {
    service.destroy()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('terminates timed-out computation and lets subsequent work finish', async () => {
    const first = service.execute('search', { text: 'large input' }).catch(error => error)
    const oldWorker = instances[0]
    const lateResponse = oldWorker.onmessage!
    await vi.advanceTimersByTimeAsync(500)
    const second = service.execute('diff', {})
    await vi.advanceTimersByTimeAsync(500)

    expect(await first).toMatchObject({ message: expect.stringContaining('timed out') })
    expect(oldWorker.terminate).toHaveBeenCalledOnce()
    expect(oldWorker.onmessage).toBeNull()
    expect(instances).toHaveLength(2)
    lateResponse({ data: { id: 'task-1', success: true, result: 'stale' } } as MessageEvent)
    instances[1].complete('fresh')
    await expect(second).resolves.toBe('fresh')
  })

  it('drops expired queued payloads without dispatching them', async () => {
    const running = service.execute('diff', {})
    config.timeout = 100
    const expired = service.execute('search', { text: 'retained payload' }).catch(error => error)
    await vi.advanceTimersByTimeAsync(100)
    expect(await expired).toMatchObject({ message: expect.stringContaining('timed out') })
    expect((service as unknown as { taskQueue: unknown[] }).taskQueue).toHaveLength(0)
    instances[0].complete('done')
    await expect(running).resolves.toBe('done')
    expect(instances[0].postMessage).toHaveBeenCalledOnce()
    expect(instances[0].terminate).not.toHaveBeenCalled()
  })

  it('rejects worker errors immediately and replaces the failed worker', async () => {
    const failed = service.execute('diff', {}).catch(error => error)
    const next = service.execute('search', {})
    instances[0].onerror?.({ message: 'worker crashed' } as ErrorEvent)
    expect(await failed).toMatchObject({ message: 'worker crashed' })
    expect(instances[0].terminate).toHaveBeenCalledOnce()
    instances[1].complete([])
    await expect(next).resolves.toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('recovers when postMessage throws before dispatch', async () => {
    service.init()
    instances[0].postMessage.mockImplementationOnce(() => { throw new Error('clone failed') })
    await expect(service.execute('diff', {})).rejects.toThrow('clone failed')
    expect(instances[0].terminate).toHaveBeenCalledOnce()
    const next = service.execute('search', {})
    instances[1].complete([])
    await expect(next).resolves.toEqual([])
  })

  it('terminates partially initialized pools on constructor failure', () => {
    vi.stubGlobal('Worker', class extends MockWorker {
      constructor() {
        if (instances.length === 1) throw new Error('worker limit')
        super()
      }
    })
    service = new WorkerService(2)
    service.init()
    expect(instances).toHaveLength(1)
    expect(instances[0].terminate).toHaveBeenCalledOnce()
  })
})
