import * as path from 'node:path'
import { normalizeAssetConfiguration } from '@shared/assets/configuration'
import type { AssetCapability, AssetJob, AssetStorageSettings } from '@shared/types/assets'
import type { AssetRepository, AssetTable } from './AssetRepository'

interface ConfigStore {
  get(key: string): unknown
  set(values: Record<string, unknown>): void
}
const CONFIG = 'assetConfiguration'
const CREDENTIALS = 'assetCredentials'
const MIGRATED = 'settingsPersistence.assetConfigMigrated'

/** Config and encrypted credentials share config.json; runtime records stay in SQLite. */
export class ConfigAssetRepository implements AssetRepository {
  private ready?: Promise<void>
  constructor(private runtime: AssetRepository, private store: ConfigStore, private configDir: string) {}

  init(): Promise<void> {
    if (!this.ready) this.ready = this.migrate().catch(error => { this.ready = undefined; throw error })
    return this.ready
  }
  private async migrate(): Promise<void> {
    if (this.store.get(MIGRATED)) return
    const [capabilities, oldStorage, jobs] = await Promise.all([
      this.runtime.list<AssetCapability>('capability'), this.runtime.get<AssetStorageSettings>('settings', 'storage'), this.runtime.list<AssetJob>('job'),
    ])
    const encrypted: Record<string, string> = {}
    const ids = new Set([...capabilities.map(cap => cap.id), ...jobs.map(job => job.capability.id)])
    for (const id of ids) {
      const secret = await this.runtime.get<string>('secret', id)
      if (secret) encrypted[id] = secret
    }
    const existing = this.store.get(CONFIG)
    const config = normalizeAssetConfiguration(existing ?? { capabilities, storage: { customRoot: oldStorage?.customRoot, projectRoots: oldStorage?.projectRoots || {} } })
    // One durable write before legacy cleanup; a reset must never resurrect old SQLite settings.
    this.store.set({ [CONFIG]: config, [CREDENTIALS]: { ...encrypted, ...this.credentials() }, [MIGRATED]: true })
    await this.runtime.delete('settings', 'storage')
    for (const cap of capabilities) await this.runtime.delete('capability', cap.id)
    for (const id of ids) await this.runtime.delete('secret', id)
  }
  private config() { return normalizeAssetConfiguration(this.store.get(CONFIG)) }
  private credentials(): Record<string, string> { return (this.store.get(CREDENTIALS) || {}) as Record<string, string> }
  async get<T>(table: AssetTable, id: string): Promise<T | undefined> {
    await this.init()
    if (table === 'job' || table === 'asset') return this.runtime.get<T>(table, id)
    if (table === 'secret') return this.credentials()[id] as T | undefined
    const config = this.config()
    if (table === 'capability') return config.capabilities.find(cap => cap.id === id) as T | undefined
    return { ...config.storage, defaultRoot: path.join(this.configDir, 'assets', 'library') } as T
  }
  async list<T>(table: AssetTable): Promise<T[]> {
    await this.init()
    if (table === 'job' || table === 'asset') return this.runtime.list<T>(table)
    if (table === 'capability') return this.config().capabilities as T[]
    if (table === 'secret') return Object.values(this.credentials()) as T[]
    return [await this.get<T>('settings', 'storage')] as T[]
  }
  async put(table: AssetTable, id: string, value: unknown): Promise<void> { await this.putMany([{ table, id, value }]) }
  async putMany(entries: Array<{ table: AssetTable; id: string; value: unknown }>): Promise<void> {
    await this.init()
    if (entries.every(entry => entry.table === 'job' || entry.table === 'asset')) return this.runtime.putMany(entries)
    if (entries.some(entry => entry.table === 'job' || entry.table === 'asset')) throw new Error('Cannot mix config and runtime transactions')
    const config = this.config(), credentials = { ...this.credentials() }
    for (const entry of entries) {
      if (entry.table === 'capability') config.capabilities = [...config.capabilities.filter(cap => cap.id !== entry.id), entry.value as AssetCapability]
      else if (entry.table === 'secret') credentials[entry.id] = entry.value as string
      else { const value = entry.value as AssetStorageSettings; config.storage = { customRoot: value.customRoot, projectRoots: value.projectRoots } }
    }
    this.store.set({ [CONFIG]: normalizeAssetConfiguration(config), [CREDENTIALS]: credentials })
  }
  async delete(table: AssetTable, id: string): Promise<void> {
    await this.init()
    if (table === 'job' || table === 'asset') return this.runtime.delete(table, id)
    if (table === 'secret') { const secrets = { ...this.credentials() }; delete secrets[id]; this.store.set({ [CREDENTIALS]: secrets }); return }
    const config = this.config()
    if (table === 'capability') config.capabilities = config.capabilities.filter(cap => cap.id !== id)
    else config.storage = { projectRoots: {} }
    this.store.set({ [CONFIG]: normalizeAssetConfiguration(config) })
  }
}
