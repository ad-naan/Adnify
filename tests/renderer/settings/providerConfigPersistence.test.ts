import { describe, expect, it } from 'vitest'
import { captureActiveProviderConfig } from '@renderer/settings/providerConfigPersistence'
import { SETTINGS } from '@shared/config/settings'

describe('provider config persistence', () => {
  it('persists extended reasoning capability with the active provider', () => {
    const active = {
      ...SETTINGS.llmConfig.default,
      provider: 'custom-test',
      model: 'reasoning-model',
      capabilities: {
        ...SETTINGS.llmConfig.default.capabilities,
        openAICompatibleSupportsExtendedReasoningEffort: true,
      },
    }

    const persisted = captureActiveProviderConfig(
      { displayName: 'Custom Test', customModels: ['reasoning-model'] },
      active,
    )

    expect(persisted.capabilities?.openAICompatibleSupportsExtendedReasoningEffort).toBe(true)
    expect(persisted.displayName).toBe('Custom Test')
    expect(persisted.customModels).toEqual(['reasoning-model'])
  })
})
