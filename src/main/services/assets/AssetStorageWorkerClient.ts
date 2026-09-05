import { join } from 'node:path'
import { UtilityProcessClient } from '../process/UtilityProcessClient'
import type { AssetRepository, AssetTable } from './AssetRepository'

export class AssetStorageWorkerClient implements AssetRepository {
  private readonly client = new UtilityProcessClient({
    entry: join(__dirname, 'assetStorage.worker.js'), name: 'Adnify Asset Storage', timeoutMs: 15_000,
  })
  constructor(private readonly databasePath: string) {}
  private request<T>(operation: string, table?: AssetTable, key?: string, value?: unknown): Promise<T> {
    return this.client.request({ operation, databasePath: this.databasePath, table, key, value })
  }
  get<T>(table: AssetTable, id: string): Promise<T | undefined> { return this.request('get', table, id) }
  list<T>(table: AssetTable): Promise<T[]> { return this.request('list', table) }
  put(table: AssetTable, id: string, value: unknown): Promise<void> { return this.request('put', table, id, value) }
  putMany(entries: Array<{ table: AssetTable; id: string; value: unknown }>): Promise<void> { return this.request('putMany', 'settings', undefined, entries) }
  delete(table: AssetTable, id: string): Promise<void> { return this.request('delete', table, id) }
  close(): Promise<void> { return this.client.close({ operation: 'close' }) }
}
