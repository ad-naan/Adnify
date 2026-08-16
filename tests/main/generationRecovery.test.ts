import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearCacheCompatibilityState,
  isCacheFeatureUnsupported,
} from '@/main/services/llm/core/CacheCompatibility'
import { executeWithGenerationRecovery } from '@/main/services/llm/core/GenerationRecovery'
import type { LLMConfig } from '@shared/types'

const config = {
  provider: 'custom-provider',
  protocol: 'openai',
  baseUrl: 'https://example.com/v1',
  model: 'unknown-model',
} as LLMConfig

describe('generation recovery cache negotiation', () => {
  beforeEach(() => {
    clearCacheCompatibilityState()
  })

  it('retries without optional cache metadata after any cached request failure', async () => {
    const execute = vi.fn(async (useCache: boolean) => {
      if (useCache) throw new Error('opaque provider validation failure')
      return 'ok'
    })

    const result = await executeWithGenerationRecovery({
      config,
      operation: 'test',
      execute,
      maxTransientRetries: 0,
    })

    expect(result).toBe('ok')
    expect(execute.mock.calls.map(call => call[0])).toEqual([true, false])
    expect(isCacheFeatureUnsupported(config, 'openai-prompt-cache-key')).toBe(true)
  })

  it('does not blame caching when the cache-free retry also fails', async () => {
    await expect(executeWithGenerationRecovery({
      config,
      operation: 'test',
      execute: async () => { throw new Error('same failure') },
      maxTransientRetries: 0,
    })).rejects.toThrow('same failure')

    expect(isCacheFeatureUnsupported(config, 'openai-prompt-cache-key')).toBe(false)
  })
})
