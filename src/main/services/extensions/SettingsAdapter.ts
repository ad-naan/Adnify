import { isDeepStrictEqual } from 'node:util'
import { cleanConfigValue } from '@shared/config/configCleaner'
import { parseSettingValue } from '@shared/config/settingValue'
import { AGENT_SETTINGS, describeSetting, mergeSettings, redactSettings, type AgentSettingDefinition } from '@shared/config/agentSettings'
import type { ExtensionPrepareRequest } from '@shared/types/extensions'
import type { PreparedExtension } from './ExtensionTransactionService'

export interface SettingsBackend {
  read(key: string): unknown
  write(key: string, value: unknown): void | Promise<void>
}
export interface SettingsPayload {
  kind: 'settings'
  key: string
  before: unknown
  after: unknown
  installed: boolean
}

export class SettingsAdapter {
  private backend?: SettingsBackend
  private readonly definitions = { ...AGENT_SETTINGS }
  private readonly custom = new Map<string, { read: () => unknown; write: (value: unknown) => void | Promise<void> }>()
  configure(backend: SettingsBackend): void { this.backend = backend }
  register(definition: AgentSettingDefinition, backend: { read: () => unknown; write: (value: unknown) => void | Promise<void> }): void {
    this.definitions[definition.key] = definition
    this.custom.set(definition.key, backend)
  }
  private getBackend(): SettingsBackend {
    if (!this.backend) throw new Error('Settings service is not initialized')
    return this.backend
  }
  private raw(key: string): unknown {
    if (this.custom.has(key)) return this.custom.get(key)!.read()
    const definition = this.definitions[key]
    const stored = this.getBackend().read(definition.storageKey)
    return definition.appField ? (stored as Record<string, unknown> | undefined)?.[definition.appField] : stored
  }
  discover(query?: string): unknown[] {
    const terms = query && query !== '*' ? query.toLowerCase().split(/\s+/) : []
    return Object.values(this.definitions)
      .filter(item => terms.every(term => `${item.key} ${item.description}`.toLowerCase().includes(term)))
      .map(item => terms.length === 0
        ? { key: item.key, description: item.description, scope: 'user', inspect: `Use kind=settings, query=${item.key} for current values and schema` }
        : describeSetting(item, this.raw(item.key) === undefined ? item.defaults : mergeSettings(item.defaults, this.raw(item.key))))
  }
  prepare(request: ExtensionPrepareRequest): PreparedExtension {
    if (request.scope !== 'user') throw new Error('Application settings currently use user scope')
    if (!Object.hasOwn(this.definitions, request.source)) {
      const root = request.source.split('.')[0]
      const hint = Object.hasOwn(this.definitions, root)
        ? ` Use source="${root}" and put the nested fields inside value; source does not accept dotted paths.`
        : ' Discover kind=settings to inspect available keys.'
      throw new Error(`Unknown setting key.${hint}`)
    }
    if (request.value === undefined) throw new Error('Settings preparation requires value')
    const definition = this.definitions[request.source]
    // Validate the patch, not persisted values, so unknown legacy fields are preserved.
    const patch = parseSettingValue(definition.key, definition.schema, request.value)
    const before = structuredClone(this.raw(definition.key))
    const candidate = mergeSettings(before === undefined ? definition.defaults : mergeSettings(definition.defaults, before), patch)
    const merged = definition.validate ? definition.validate(candidate) : candidate
    const cleaned = cleanConfigValue(definition.storageKey, definition.appField ? { [definition.appField]: merged } : merged)
    const after = JSON.parse(JSON.stringify(definition.appField ? (cleaned as Record<string, unknown>)[definition.appField] : cleaned))
    const summary = JSON.stringify(redactSettings({ [definition.key]: { before: before ?? definition.defaults, after } }))
    return {
      displayName: definition.key, summary: `Update user setting ${definition.key}: ${summary}`,
      risk: 'dangerous', credentialRequirements: [],
      payload: { kind: 'settings', key: definition.key, before, after, installed: false } satisfies SettingsPayload,
    }
  }
  private async write(payload: SettingsPayload, value: unknown): Promise<void> {
    if (this.custom.has(payload.key)) return this.custom.get(payload.key)!.write(value)
    const definition = this.definitions[payload.key]
    if (definition.appField) {
      const latest = this.getBackend().read(definition.storageKey) as Record<string, unknown> || {}
      const next = { ...latest }
      if (value === undefined) delete next[definition.appField]
      else next[definition.appField] = value
      await this.getBackend().write(definition.storageKey, next)
    } else await this.getBackend().write(definition.storageKey, value)
  }
  async apply(payload: SettingsPayload): Promise<void> {
    if (!isDeepStrictEqual(this.raw(payload.key), payload.before)) throw new Error('This setting changed after preparation. Discover and prepare it again.')
    payload.installed = true
    await this.write(payload, payload.after)
  }
  verify(payload: SettingsPayload) {
    const ok = isDeepStrictEqual(this.raw(payload.key), payload.after)
    return { ok, status: ok ? 'saved-and-broadcast' : 'settings-readback-mismatch' }
  }
  async rollback(payload: SettingsPayload): Promise<void> {
    if (!payload.installed) return
    const current = this.raw(payload.key)
    if (!isDeepStrictEqual(current, payload.after) && !isDeepStrictEqual(current, payload.before)) {
      throw new Error('Setting changed again during application; refusing to overwrite a newer edit during rollback')
    }
    await this.write(payload, payload.before)
    payload.installed = false
  }
}

export const settingsAdapter = new SettingsAdapter()
