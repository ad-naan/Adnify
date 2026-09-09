import { describe, expect, it, vi } from 'vitest'
import { createPersistentPreference } from '../../../src/renderer/settings/persistentPreference'

const bridge = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), onChanged: vi.fn() }))
vi.mock('@/renderer/services/electronAPI', () => ({ api: { settings: bridge } }))

describe('Agent setting rollback propagation', () => {
  it('restores the default in a hydrated renderer when the persisted key is deleted', async () => {
    bridge.get.mockResolvedValue({ enabled: true })
    const preference = createPersistentPreference({
      storageKey: 'sync-test', legacyStorageKey: 'sync-test-legacy', fallback: { enabled: false },
      normalize: value => ({ enabled: (value as { enabled?: boolean } | undefined)?.enabled === true }),
    })
    await preference.hydrate()
    expect(preference.load()).toEqual({ enabled: true })
    const listener = bridge.onChanged.mock.calls[0][0]
    listener({ key: 'sync-test', value: undefined })
    expect(preference.load()).toEqual({ enabled: false })
  })
})
