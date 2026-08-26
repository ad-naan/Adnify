import { afterEach, describe, expect, it, vi } from 'vitest'
import { calculateWorkerPoolSize } from '@/renderer/services/workerPoolPolicy'
import { WorkerService } from '@/renderer/services/workerService'

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
