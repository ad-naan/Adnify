import { randomUUID } from 'crypto'
import * as path from 'path'
import { Worker } from 'worker_threads'
import type { CodeChunk } from './types'
import type {
  StructuralIndexMetadata,
  StructuralIndexStoreMessage,
  StructuralIndexStoreOperation,
  StructuralIndexStoreRequest,
  StructuralIndexStoreResult,
  StructuralIndexCursor,
} from './structuralIndexStore.types'

const REQUEST_TIMEOUT_MS = 30_000

interface PendingRequest {
  resolve: (result: StructuralIndexStoreResult) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

export class StructuralIndexStore {
  private worker: Worker | null = null
  private readonly pending = new Map<string, PendingRequest>()

  constructor(private readonly databasePath: string) {}

  async load(onBatch: (chunks: CodeChunk[]) => void): Promise<StructuralIndexMetadata | null> {
    let cursor: StructuralIndexCursor | undefined
    let metadata: StructuralIndexMetadata | null = null
    let loadedChunks = 0
    do {
      const result = await this.request({
        type: 'loadPage',
        databasePath: this.databasePath,
        cursor,
      })
      if (result.type !== 'loadedPage') throw new Error('Invalid structural index load response')
      metadata = result.metadata
      if (!metadata) return null
      if (result.chunks.length > 0) {
        onBatch(result.chunks)
        loadedChunks += result.chunks.length
      }
      cursor = result.nextCursor || undefined
    } while (cursor)

    if (loadedChunks !== metadata.totalChunks) {
      throw new Error(`Structural index is incomplete: expected ${metadata.totalChunks} chunks, loaded ${loadedChunks}`)
    }
    return metadata
  }

  request(operation: StructuralIndexStoreOperation): Promise<StructuralIndexStoreResult> {
    const worker = this.ensureWorker()
    const requestId = randomUUID()
    const request: StructuralIndexStoreRequest = { requestId, operation }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.failWorker(new Error(`Structural index store timed out: ${operation.type}`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(requestId, { resolve, reject, timeout })
      worker.postMessage(request)
    })
  }

  async close(): Promise<void> {
    const worker = this.worker
    if (!worker) return
    try {
      await this.request({ type: 'close', databasePath: this.databasePath })
    } finally {
      if (this.worker === worker) this.worker = null
      await worker.terminate()
    }
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(path.join(__dirname, 'structuralIndexStore.worker.js'))
    worker.on('message', (message: StructuralIndexStoreMessage) => this.handleMessage(message))
    worker.on('error', error => this.failWorker(error))
    worker.on('exit', code => {
      if (this.worker !== worker) return
      if (this.pending.size > 0) {
        this.failWorker(new Error(`Structural index store exited unexpectedly with code ${code}`))
      } else {
        this.worker = null
      }
    })
    this.worker = worker
    return worker
  }

  private handleMessage(message: StructuralIndexStoreMessage): void {
    const pending = this.pending.get(message.requestId)
    if (!pending) return
    this.pending.delete(message.requestId)
    clearTimeout(pending.timeout)
    if (message.ok) pending.resolve(message.result)
    else pending.reject(new Error(message.error))
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
