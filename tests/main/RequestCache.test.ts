import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LLMConfig } from '@shared/types'
import { prepareRequestCache } from '@main/services/llm/core/RequestCache'
import {
  clearCacheCompatibilityState,
  isCacheFeatureUnsupported,
  markCacheFeatureUnsupported,
} from '@main/services/llm/core/CacheCompatibility'

const longPrompt = 'cacheable prefix '.repeat(2000)

describe('RequestCache', () => {
  afterEach(() => {
    vi.useRealTimers()
    clearCacheCompatibilityState()
  })

  it('applies OpenAI-compatible cache options for custom protocol providers', async () => {
    const config: LLMConfig = {
      provider: 'custom-provider',
      protocol: 'custom',
      model: 'gpt-4.1',
      apiKey: 'test-key',
      baseUrl: 'https://example.com/v1',
    }

    const result = await prepareRequestCache(config, [
      { role: 'user', content: longPrompt },
      { role: 'assistant', content: 'Previous reply' },
      { role: 'user', content: 'Newest turn' },
    ])

    expect(result.providerOptions?.openai?.promptCacheKey).toBeTypeOf('string')
    expect(result.providerOptions?.custom?.promptCacheKey).toBeTypeOf('string')
  })
})

describe('CacheCompatibility', () => {
  afterEach(() => {
    vi.useRealTimers()
    clearCacheCompatibilityState()
  })

  it('only disables unsupported cache features for a cooldown window', () => {
    vi.useFakeTimers()

    const config: LLMConfig = {
      provider: 'openai',
      protocol: 'openai',
      model: 'gpt-4.1',
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1',
    }

    markCacheFeatureUnsupported(config, 'openai-prompt-cache-key', 'unsupported parameter')

    expect(isCacheFeatureUnsupported(config, 'openai-prompt-cache-key')).toBe(true)

    vi.advanceTimersByTime(10 * 60 * 1000 + 1)

    expect(isCacheFeatureUnsupported(config, 'openai-prompt-cache-key')).toBe(false)
  })
})
