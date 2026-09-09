import { describe, expect, it } from 'vitest'
import { SettingsAdapter, type SettingsPayload } from './SettingsAdapter'
import { AGENT_SETTINGS } from '@shared/config/agentSettings'

function setup(initial: Record<string, unknown> = {}) {
  const data = structuredClone(initial)
  const adapter = new SettingsAdapter()
  adapter.configure({ read: key => data[key], write: (key, value) => {
    if (value === undefined) delete data[key]
    else data[key] = JSON.parse(JSON.stringify(value))
  } })
  const prepare = (source: string, value: unknown) => adapter.prepare({ kind: 'settings', source, value, scope: 'user' })
  return { data, adapter, prepare }
}

describe('application settings transactions', () => {
  const fontFamily = "'JetBrains Mono', 'Cascadia Code', Consolas, 'Microsoft YaHei', monospace"

  it.each([
    { fontFamily },
    { fontSize: 14 },
    { fontFamily, terminal: { fontFamily } },
  ])('accepts a JSON-encoded editor patch without changing its field values: %j', async patch => {
    const { adapter, data, prepare } = setup({ editorConfig: { fontSize: 16, wordWrap: 'off' } })
    const native = prepare('editorConfig', patch)
    const encoded = prepare('editorConfig', JSON.stringify(patch))
    expect(encoded.summary).toBe(native.summary)
    expect(data.editorConfig).toEqual({ fontSize: 16, wordWrap: 'off' })
    const payload = encoded.payload as SettingsPayload
    await adapter.apply(payload)
    expect(data.editorConfig).toMatchObject({ ...patch, wordWrap: 'off' })
    expect(adapter.verify(payload).ok).toBe(true)
  })

  it('prepares without writing, merges nested fields and restores the exact previous value', async () => {
    const { adapter, data, prepare } = setup({ editorConfig: { fontSize: 16, terminal: { fontSize: 18 } } })
    const before = structuredClone(data)
    const payload = prepare('editorConfig', { terminal: { cursorBlink: false } }).payload as SettingsPayload
    expect(data).toEqual(before)
    await adapter.apply(payload)
    expect(data.editorConfig).toMatchObject({ fontSize: 16, terminal: { fontSize: 18, cursorBlink: false } })
    expect(adapter.verify(payload).ok).toBe(true)
    await adapter.rollback(payload)
    expect(data).toEqual(before)
  })

  it('preserves sibling app settings changed after preparation and rejects edits to the same setting', async () => {
    const { adapter, data, prepare } = setup({ 'app-settings': { language: 'en', aiInstructions: 'original' } })
    const payload = prepare('language', 'zh').payload as SettingsPayload
    data['app-settings'] = { language: 'en', aiInstructions: 'new' }
    await adapter.apply(payload)
    expect(data['app-settings']).toEqual({ language: 'zh', aiInstructions: 'new' })
    const stale = prepare('language', 'en').payload as SettingsPayload
    data['app-settings'] = { language: 'en', aiInstructions: 'new' }
    await expect(adapter.apply(stale)).rejects.toThrow('changed after preparation')
    await adapter.rollback(stale)
    expect(data['app-settings']).toEqual({ language: 'en', aiInstructions: 'new' })
  })

  it('redacts stored credentials from discovery and both sides of previews', () => {
    const { adapter, prepare } = setup({ 'app-settings': {
      githubToken: 'github-secret', webSearchConfig: { googleApiKey: 'google-secret', googleCx: 'cx' },
      providerConfigs: { custom: { apiKey: 'provider-secret', headers: { Authorization: 'header-secret' } } },
    } })
    const output = JSON.stringify(['githubToken', 'webSearchConfig', 'providerConfigs'].flatMap(key => adapter.discover(key)))
    for (const secret of ['github-secret', 'google-secret', 'provider-secret', 'header-secret']) expect(output).not.toContain(secret)
    const change = prepare('githubToken', 'new-secret')
    expect(change.summary).not.toContain('new-secret')
    expect(change.summary).not.toContain('github-secret')
  })

  it('validates unknown keys, nested fields, enum values, ranges and prototype properties', () => {
    const { prepare } = setup()
    expect(() => prepare('providerCredentials', {})).toThrow('Unknown setting')
    expect(() => prepare('__proto__', {})).toThrow('Unknown setting')
    expect(() => prepare('editorConfig', { typo: true })).toThrow()
    expect(() => prepare('language', 'invalid')).toThrow()
    expect(() => prepare('editorConfig', { fontSize: -1 })).toThrow()
    expect(() => prepare('providerConfigs', JSON.parse('{"constructor":{"model":"bad"}}'))).toThrow()
    expect(() => prepare('providerConfigs', { custom: { apiKey: 'secret' } })).toThrow()
    expect(() => prepare('editorConfig.fontFamily', { fontFamily: 'Mono' })).toThrow('Use source="editorConfig"')
    expect(() => prepare('editorConfig', JSON.stringify({ editorConfig: { fontFamily: 'Mono' } }))).toThrow('without an extra setting-key wrapper')
  })

  it('round-trips a patch for every registered default through JSON persistence', async () => {
    for (const definition of Object.values(AGENT_SETTINGS)) {
      const { adapter, prepare } = setup()
      // The provider registry intentionally exposes only non-secret editable fields.
      const patch = typeof definition.defaults === 'object' && !Array.isArray(definition.defaults) ? {} : definition.defaults
      const payload = prepare(definition.key, patch).payload as SettingsPayload
      await adapter.apply(payload)
      expect(adapter.verify(payload), definition.key).toMatchObject({ ok: true })
      await adapter.rollback(payload)
    }
  })

  it('persists optional Agent fields through the normal configuration cleaner', async () => {
    const { prepare, data, adapter } = setup()
    const patch = { retryBackoffMultiplier: 2, pruneProtectTokens: 1000, summaryMaxContextChars: { quick: 5000 }, dynamicConcurrency: { enabled: true, maxConcurrency: 4 } }
    const payload = prepare('agentConfig', patch).payload as SettingsPayload
    await adapter.apply(payload)
    expect(data['app-settings']).toMatchObject({ agentConfig: patch })
  })

  it('does not roll back over a newer edit', async () => {
    const { prepare, adapter, data } = setup({ 'app-settings': { language: 'en' } })
    const payload = prepare('language', 'zh').payload as SettingsPayload
    await adapter.apply(payload)
    data['app-settings'] = { language: 'other-new-value' }
    await expect(adapter.rollback(payload)).rejects.toThrow('newer edit')
    expect(data['app-settings']).toEqual({ language: 'other-new-value' })
  })
})
