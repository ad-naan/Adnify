import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelMessage } from '@ai-sdk/provider-utils'
import type { LLMConfig } from '@shared/types'
import { prepareRequestCache } from '@main/services/llm/core/RequestCache'

function createConfig(overrides: Partial<LLMConfig>): LLMConfig {
  return {
    provider: 'openai',
    model: 'upstream-mapped-model',
    apiKey: 'test-key',
    ...overrides,
  }
}

function longText(label: string, repeat = 500): string {
  return `${label} `.repeat(repeat).trim()
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('prepareRequestCache', () => {
  it('uses a stable OpenAI prompt cache key for large stable prefixes', async () => {
    const messages: ModelMessage[] = [
      { role: 'system', content: longText('system') },
      { role: 'user', content: longText('context') },
      { role: 'assistant', content: 'Working notes' },
      { role: 'user', content: 'What changed in this file?' },
    ]

    const result = await prepareRequestCache(
      createConfig({ provider: 'openai', protocol: 'openai', model: 'tenant-routing-alias' }),
      messages,
    )

    expect(result.messages).toEqual(messages)
    expect((result.providerOptions?.openai as Record<string, unknown>)?.promptCacheKey).toMatch(
      /^openai:openai:tenant-routing-alias:/,
    )
  })

  it('adds a single Anthropic cache breakpoint near the end of the stable prefix', async () => {
    const messages: ModelMessage[] = [
      { role: 'system', content: 'You are a coding assistant.' },
      { role: 'user', content: longText('repository context', 300) },
      { role: 'assistant', content: 'Acknowledged.' },
      { role: 'user', content: 'Please summarize the latest edits.' },
    ]

    const result = await prepareRequestCache(
      createConfig({ provider: 'anthropic', protocol: 'anthropic', model: 'corp-claude-route' }),
      messages,
    )

    const cachedMessage = result.messages[2]
    expect(cachedMessage.providerOptions).toMatchObject({
      anthropic: {
        cacheControl: { type: 'ephemeral' },
      },
    })
    expect(result.messages[0].providerOptions).toBeUndefined()
    expect(result.messages[1].providerOptions).toBeUndefined()
  })

  it('strips cached Gemini prefixes when explicit cached content is reused', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: 'cachedContents/test-cache',
        expireTime: new Date(Date.now() + 3600_000).toISOString(),
      }),
    }))

    const messages: ModelMessage[] = [
      { role: 'system', content: longText('system', 200) },
      { role: 'user', content: longText('codebase', 400) },
      { role: 'assistant', content: 'Indexed.' },
      { role: 'user', content: 'Answer the current question.' },
    ]

    const result = await prepareRequestCache(
      createConfig({ provider: 'gemini', protocol: 'google', model: 'proxy-google-route' }),
      messages,
    )

    expect(result.messages.length).toBeLessThan(messages.length)
    expect(result.providerOptions?.google).toMatchObject({
      cacheConfig: {
        enabled: true,
      },
      cachedContent: 'cachedContents/test-cache',
    })
    expect(result.cacheWriteTokens).toBeGreaterThan(0)
  })
})
