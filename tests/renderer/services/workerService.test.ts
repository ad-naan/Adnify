import { afterEach, describe, expect, it, vi } from 'vitest'

describe('workerService resource usage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('caps the renderer-local worker pool at two workers', async () => {
    const { calculateWorkerPoolSize } = await import('@/renderer/services/workerService')

    expect(calculateWorkerPoolSize(1)).toBe(1)
    expect(calculateWorkerPoolSize(2)).toBe(1)
    expect(calculateWorkerPoolSize(4)).toBe(2)
    expect(calculateWorkerPoolSize(32)).toBe(2)
  })

  it('does not create workers until the service is used', async () => {
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

    vi.stubGlobal('navigator', { hardwareConcurrency: 32 })
    vi.stubGlobal('Worker', MockWorker)

    const { workerService } = await import('@/renderer/services/workerService')
    expect(created).toBe(0)

    workerService.init()
    expect(created).toBe(2)

    workerService.destroy()
    expect(terminated).toBe(2)
  })
})
