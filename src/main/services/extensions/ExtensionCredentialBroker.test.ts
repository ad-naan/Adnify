import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const values = new Map<string, unknown>()
  return {
    values,
    store: {
      get: vi.fn((key: string) => values.get(key)),
      set: vi.fn((key: string, value: unknown) => values.set(key, value)),
    },
  }
})

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'dpapi',
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf-8'),
    decryptString: (value: Buffer) => value.toString('utf-8').replace(/^encrypted:/, ''),
  },
}))

vi.mock('../configPath', () => ({ createScopedStore: () => mocks.store }))

import { ExtensionCredentialBroker } from './ExtensionCredentialBroker'

describe('ExtensionCredentialBroker', () => {
  beforeEach(() => {
    mocks.values.clear()
    vi.clearAllMocks()
  })

  it('stores encrypted values and resolves markers only inside the main process', () => {
    const broker = new ExtensionCredentialBroker()
    const reference = broker.reference('github-server', 'GITHUB_TOKEN')
    broker.set(reference, 'plain-secret')

    expect(JSON.stringify(mocks.values.get('encryptedSecrets'))).not.toContain('plain-secret')
    expect(broker.status([reference])).toEqual([{ reference, configured: true }])
    expect(broker.resolveConfig({
      type: 'local',
      id: 'github-server',
      name: 'GitHub',
      command: 'npx',
      env: { GITHUB_TOKEN: broker.marker(reference) },
    })).toMatchObject({ env: { GITHUB_TOKEN: 'plain-secret' } })
    expect(broker.redact('server echoed plain-secret in stderr')).toBe('server echoed [REDACTED] in stderr')
  })

  it('fails closed for missing and invalid credential references', () => {
    const broker = new ExtensionCredentialBroker()
    const reference = broker.reference('server', 'TOKEN')

    expect(() => broker.resolveConfig({
      type: 'remote',
      id: 'server',
      name: 'Server',
      url: 'https://example.com/mcp',
      headers: { Authorization: broker.marker(reference) },
    })).toThrow('not configured')
    expect(() => broker.reference('server', 'TOKEN/../../secret')).toThrow('Unsupported')
  })

  it('removes credentials without returning their values', () => {
    const broker = new ExtensionCredentialBroker()
    const reference = broker.reference('server', 'TOKEN')
    broker.set(reference, 'secret')

    expect(broker.remove(reference)).toBe(true)
    expect(broker.status([reference])).toEqual([{ reference, configured: false }])
    expect(broker.remove(reference)).toBe(false)
  })
})
