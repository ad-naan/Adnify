import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import type { AssetRepository, AssetTable } from './AssetRepository'

export class AssetStorageWorkerClient implements AssetRepository {
  private worker?: Worker
  private sequence = 0
  private closed = false
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  constructor(private readonly databasePath: string) {}
  private request(operation: string, table: AssetTable, key?: string, value?: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('Asset storage has closed'))
    if (!this.worker) {
      const worker = new Worker(join(__dirname, 'assetStorage.worker.js'), { workerData: { databasePath: this.databasePath } })
      this.worker = worker
      worker.on('message', response => {
        const pending = this.pending.get(response.id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pending.delete(response.id)
        if (response.error) pending.reject(new Error(response.error))
        else pending.resolve(response.result)
      })
      const fail = (error: Error) => {
        if (this.worker !== worker) return
        this.worker = undefined
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }
        this.pending.clear()
      }
      worker.on('error', fail)
      worker.on('exit', () => fail(new Error('Asset storage worker stopped')))
      worker.unref()
    }
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Asset storage timed out')) }, 15_000)
      this.pending.set(id, { resolve, reject, timer })
      this.worker!.postMessage({ id, operation, table, key, value })
    })
  }
  async get<T>(table: AssetTable, id: string): Promise<T | undefined> { return await this.request('get', table, id) as T | undefined }
  async list<T>(table: AssetTable): Promise<T[]> { return await this.request('list', table) as T[] }
  async put(table: AssetTable, id: string, value: unknown): Promise<void> { await this.request('put', table, id, value) }
  async putMany(entries: Array<{ table: AssetTable; id: string; value: unknown }>): Promise<void> { await this.request('putMany', 'settings', undefined, entries) }
  async delete(table: AssetTable, id: string): Promise<void> { await this.request('delete', table, id) }
  async close(): Promise<void> { this.closed = true; await this.worker?.terminate(); this.worker = undefined }
}
