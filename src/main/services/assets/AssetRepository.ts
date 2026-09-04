export type AssetTable = 'settings' | 'capability' | 'secret' | 'job' | 'asset'
export interface AssetRepository {
  get<T>(table: AssetTable, id: string): Promise<T | undefined>
  list<T>(table: AssetTable): Promise<T[]>
  put(table: AssetTable, id: string, value: unknown): Promise<void>
  putMany(entries: Array<{ table: AssetTable; id: string; value: unknown }>): Promise<void>
  delete(table: AssetTable, id: string): Promise<void>
}
