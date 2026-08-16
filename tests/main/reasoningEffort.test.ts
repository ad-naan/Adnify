import { describe, expect, it } from 'vitest'
import { buildThinkingProviderOptions } from '@/main/services/llm/core/ProviderCompatibility'
import type { LLMConfig } from '@shared/types'

const base = (over: Partial<LLMConfig>): LLMConfig => ({
  provider: 'openai', model: 'gpt-5.6', enableThinking: true, ...over,
} as LLMConfig)

describe('reasoning effort per protocol', () => {
  it('openai full passes max through', () => {
    const o = buildThinkingProviderOptions(base({ reasoningEffort: 'max', openAICompatibilityProfile: 'full' }))
    expect((o as any)?.openai?.reasoningEffort).toBe('max')
  })
  it('openai compatible clamps max to high', () => {
    const o = buildThinkingProviderOptions(base({
      provider: 'custom', protocol: 'openai', reasoningEffort: 'max', openAICompatibilityProfile: 'compatible',
    }))
    const bag = (o as any)?.openaiCompatible ?? (o as any)?.['custom-openai']
    expect(bag?.reasoningEffort).toBe('high')
  })
  it('openai compatible forwards xhigh and max when extended effort is enabled', () => {
    for (const effort of ['xhigh', 'max'] as const) {
      const o = buildThinkingProviderOptions(base({
        provider: 'custom',
        protocol: 'openai',
        reasoningEffort: effort,
        openAICompatibilityProfile: 'compatible',
        capabilities: { openAICompatibleSupportsExtendedReasoningEffort: true },
      }))
      const bag = (o as any)?.openaiCompatible ?? (o as any)?.['custom-openai']
      expect(bag?.reasoningEffort).toBe(effort)
    }
  })
  it('anthropic forwards xhigh and max', () => {
    for (const e of ['xhigh', 'max'] as const) {
      const o = buildThinkingProviderOptions(base({ provider: 'anthropic', protocol: 'anthropic', reasoningEffort: e }))
      expect((o as any)?.anthropic?.effort).toBe(e)
    }
  })
  it('google clamps max to high', () => {
    const o = buildThinkingProviderOptions(base({
      provider: 'gemini', protocol: 'google', reasoningEffort: 'max',
      capabilities: { googleThinkingMode: 'level' },
    } as any))
    expect((o as any)?.google?.thinkingConfig?.thinkingLevel).toBe('high')
  })
})
