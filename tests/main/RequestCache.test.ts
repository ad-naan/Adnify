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

/** Generate text large enough to exceed Google explicit cache token threshold (32768). */
function longTextForCache(label: string): string {
  // ~8 chars per token; 20000 repeats ≈ 40k+ tokens without expensive counting loops
  return `${label} `.repeat(20000).trim()
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
    expect((result.providerOptions?.openai as Record<string, unknown>)?.promptCacheKey)
      .toBe('openai:openai:tenant-routing-alias')
  })

  it('still attempts prompt caching through an OpenAI-compatible proxy', async () => {
    const messages: ModelMessage[] = [
      { role: 'system', content: longText('system') },
      { role: 'user', content: longText('context') },
      { role: 'assistant', content: 'Working notes' },
      { role: 'user', content: 'Continue.' },
    ]

    const result = await prepareRequestCache(
      createConfig({
        provider: 'custom-proxy',
        protocol: 'openai',
        model: 'proxy-model',
        baseUrl: 'https://proxy.example/v1',
        openAICompatibilityProfile: 'compatible',
      }),
      messages,
    )

    expect(result.providerOptions?.customOpenai).toMatchObject({
      prompt_cache_key: 'custom-proxy:openai:proxy-model',
    })
  })

  it('adds a stable explicit breakpoint when Responses cache options are enabled', async () => {
    const messages: ModelMessage[] = [
      { role: 'system', content: longText('stable policy') },
      { role: 'system', content: '## Environment\n- Active File: changing.ts' },
      { role: 'user', content: 'Continue.' },
    ]

    const result = await prepareRequestCache(
      createConfig({
        provider: 'openai',
        protocol: 'openai-responses',
        model: 'reasoning-route',
        providerOptions: {
          openai: { promptCacheOptions: { mode: 'explicit', ttl: '30m' } },
        },
      }),
      messages,
    )

    expect(result.messages[0].providerOptions).toMatchObject({
      openai: { promptCacheBreakpoint: { mode: 'explicit' } },
    })
    expect(result.messages[1].providerOptions).toBeUndefined()
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
    expect(result.messages[0].providerOptions).toMatchObject({
      anthropic: { cacheControl: { type: 'ephemeral' } },
    })
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
      { role: 'system', content: longTextForCache('system') },
      { role: 'user', content: longTextForCache('codebase') },
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
