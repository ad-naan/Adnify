import { describe, expect, it } from 'vitest'
import type { LLMConfig } from '@shared/types'
import { buildGenerationSettings } from '@main/services/llm/core/RequestSettings'
import { buildThinkingProviderOptions } from '@main/services/llm/core/ProviderCompatibility'
import { ThinkingStrategyFactory, XmlTagThinkingStrategy, StandardThinkingStrategy } from '@main/services/llm/strategies/ThinkingStrategy'

function createConfig(overrides: Partial<LLMConfig>): LLMConfig {
  return {
    provider: 'openai',
    model: 'proxy-route',
    apiKey: 'test-key',
    protocol: 'openai',
    temperature: 0.7,
    topP: 1,
    frequencyPenalty: 0.2,
    presencePenalty: 0.1,
    reasoningEffort: 'medium',
    ...overrides,
  }
}

describe('LLM capability-driven behavior', () => {
  it('disables OpenAI sampling params only when the route is explicitly marked as reasoning-only', () => {
    const result = buildGenerationSettings(createConfig({
      capabilities: {
        openAIReasoningModel: true,
        openAIReasoningSupportsSampling: false,
      },
    }))

    expect(result.temperature).toBeUndefined()
    expect(result.topP).toBeUndefined()
    expect(result.frequencyPenalty).toBeUndefined()
    expect(result.presencePenalty).toBeUndefined()
  })

  it('uses Google level-based thinking config only when explicitly declared', () => {
    const options = buildThinkingProviderOptions(createConfig({
      provider: 'gemini',
      protocol: 'google',
      capabilities: {
        googleThinkingMode: 'level',
      },
      reasoningEffort: 'high',
    }))

    expect(options).toMatchObject({
      google: {
        thinkingConfig: {
          thinkingLevel: 'high',
          includeThoughts: true,
        },
      },
    })
  })

  it('selects xml think parsing only when explicitly declared', () => {
    expect(ThinkingStrategyFactory.create('native')).toBeInstanceOf(StandardThinkingStrategy)
    expect(ThinkingStrategyFactory.create('xml-think')).toBeInstanceOf(XmlTagThinkingStrategy)
  })
})
