import { Worker } from 'worker_threads'
import * as path from 'path'
import { randomUUID } from 'crypto'
import type {
  SessionWorkerOperation,
  SessionWorkerRequest,
  SessionWorkerResponse,
  SessionWorkerResult,
} from '@shared/types/sessionPersistence'

const REQUEST_TIMEOUT_MS = 15_000

interface PendingRequest {
  resolve: (result: SessionWorkerResult) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

export class SessionStorageWorkerClient {
  private worker: Worker | null = null
  private readonly pending = new Map<string, PendingRequest>()

  request(operation: SessionWorkerOperation): Promise<SessionWorkerResult> {
    const worker = this.ensureWorker()
    const requestId = randomUUID()
    const request: SessionWorkerRequest = { requestId, operation }

    return new Promise<SessionWorkerResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`Session storage request timed out: ${operation.type}`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(requestId, { resolve, reject, timeout })
      worker.postMessage(request)
    })
  }

  async closeAll(): Promise<void> {
    const worker = this.worker
    if (!worker) return
    try {
      await this.request({ type: 'closeAll' })
    } finally {
      if (this.worker === worker) this.worker = null
      await worker.terminate()
    }
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker

    const workerPath = path.join(__dirname, 'sessionStorage.worker.js')
    const worker = new Worker(workerPath)
    worker.on('message', (response: SessionWorkerResponse) => this.handleResponse(response))
    worker.on('error', error => this.failWorker(error))
    worker.on('exit', code => {
      if (code !== 0 && this.worker === worker) {
        this.failWorker(new Error(`Session storage worker exited with code ${code}`))
      }
      if (this.worker === worker) this.worker = null
    })
    this.worker = worker
    return worker
  }

  private handleResponse(response: SessionWorkerResponse): void {
    const pending = this.pending.get(response.requestId)
    if (!pending) return
    this.pending.delete(response.requestId)
    clearTimeout(pending.timeout)
    if (response.ok) pending.resolve(response.result)
    else pending.reject(new Error(response.error))
  }

  private failWorker(error: Error): void {
    const worker = this.worker
    this.worker = null
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
    void worker?.terminate()
  }
}

export const sessionStorageWorker = new SessionStorageWorkerClient()
