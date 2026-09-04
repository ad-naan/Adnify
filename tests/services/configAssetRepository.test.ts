import { describe, expect, it } from 'vitest'
import { ConfigAssetRepository } from '@/main/services/assets/ConfigAssetRepository'
import type { AssetRepository, AssetTable } from '@/main/services/assets/AssetRepository'
import { normalizeAssetConfiguration } from '@/shared/assets/configuration'
import { isSensitiveSettingsKey } from '@/main/ipc/sensitiveSettings'
import { cleanConfigValue } from '@/shared/config/configCleaner'
import { USER_PREFERENCES } from '@/renderer/settings/userPreferences'
import fixture from '../../docs/examples/image-service-config.json'

class Runtime implements AssetRepository {
  data = new Map<string, unknown>()
  async get<T>(table: AssetTable, id: string) { return structuredClone(this.data.get(`${table}:${id}`)) as T }
  async list<T>(table: AssetTable) { return [...this.data].filter(([key]) => key.startsWith(`${table}:`)).map(([, value]) => structuredClone(value) as T) }
  async put(table: AssetTable, id: string, value: unknown) { this.data.set(`${table}:${id}`, structuredClone(value)) }
  async putMany(entries: Array<{ table: AssetTable; id: string; value: unknown }>) { for (const entry of entries) await this.put(entry.table, entry.id, entry.value) }
  async delete(table: AssetTable, id: string) { this.data.delete(`${table}:${id}`) }
}
class Store {
  data: Record<string, unknown> = {}
  fail = false
  get(key: string) { return structuredClone(this.data[key]) }
  set(values: Record<string, unknown>) { if (this.fail) throw new Error('disk full'); Object.assign(this.data, structuredClone(values)) }
}
async function setup() {
  const runtime = new Runtime(), store = new Store()
  await runtime.put('capability', fixture.id, fixture)
  await runtime.put('secret', fixture.id, 'encrypted-cookie')
  await runtime.put('settings', 'storage', { defaultRoot: '/old/library', customRoot: '/custom/library', projectRoots: { '/project': '/project/.adnify/assets' } })
  await runtime.put('job', 'job-1', { id: 'job-1', capability: fixture })
  return { runtime, store, repo: new ConfigAssetRepository(runtime, store, '/config') }
}
describe('asset settings share the application config', () => {
  it('migrates config and encrypted credentials once, leaving runtime records in SQLite', async () => {
    const { runtime, store, repo } = await setup()
    await repo.init()
    expect(normalizeAssetConfiguration(store.get('assetConfiguration')).capabilities[0].id).toBe(fixture.id)
    expect(store.get('assetCredentials')).toEqual({ [fixture.id]: 'encrypted-cookie' })
    expect(await runtime.list('capability')).toEqual([])
    expect(await runtime.list('secret')).toEqual([])
    expect(await runtime.list('job')).toHaveLength(1)
    expect(await repo.get('secret', fixture.id)).toBe('encrypted-cookie')
    expect(await repo.get('settings', 'storage')).toMatchObject({ customRoot: '/custom/library' })
    await repo.put('capability', fixture.id, { ...fixture, name: 'Updated' })
    expect(normalizeAssetConfiguration(store.get('assetConfiguration')).capabilities[0].name).toBe('Updated')
    expect(await runtime.list('capability')).toEqual([])
  })
  it('does not remove legacy config on write failure and retries migration', async () => {
    const { runtime, store, repo } = await setup()
    store.fail = true
    await expect(repo.init()).rejects.toThrow('disk full')
    expect(await runtime.list('capability')).toHaveLength(1)
    expect(await runtime.get('secret', fixture.id)).toBe('encrypted-cookie')
    store.fail = false
    await repo.init()
    expect(await runtime.list('capability')).toEqual([])
  })
  it('uses imported settings immediately and never resurrects stale config after reset', async () => {
    const { runtime, store, repo } = await setup()
    await repo.init()
    store.set({ assetConfiguration: { capabilities: [{ ...fixture, name: 'Imported' }], storage: { projectRoots: {} } } })
    expect(await repo.get('capability', fixture.id)).toMatchObject({ name: 'Imported' })
    await runtime.put('capability', fixture.id, fixture)
    delete store.data.assetConfiguration
    const restarted = new ConfigAssetRepository(runtime, store, '/config')
    expect(await restarted.list('capability')).toEqual([])
  })
  it('registers backup/reset configuration and protects credentials from generic settings IPC', () => {
    expect(USER_PREFERENCES.assetConfiguration.storageKey).toBe('assetConfiguration')
    expect(cleanConfigValue('assetConfiguration', { capabilities: [fixture], storage: { projectRoots: {} }, secret: 'do-not-persist' })).not.toHaveProperty('secret')
    expect(isSensitiveSettingsKey('assetCredentials')).toBe(true)
    expect(isSensitiveSettingsKey('assetCredentials.someId')).toBe(true)
    expect(isSensitiveSettingsKey('assetConfiguration')).toBe(false)
  })
})
