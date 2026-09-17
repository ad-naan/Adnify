import { describe, expect, it } from 'vitest'
import type { LLMConfig } from '@shared/types'
import { buildGenerationSettings, buildRequestExecutionOptions } from '@main/services/llm/core/RequestSettings'
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

  it('omits unsupported sampling params for Responses reasoning requests', () => {
    const result = buildGenerationSettings(createConfig({
      protocol: 'openai-responses',
      reasoningEffort: 'medium',
    }))

    expect(result.temperature).toBeUndefined()
    expect(result.topP).toBeUndefined()
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

  it('uses inactivity timeouts instead of a total timeout for streaming', () => {
    const result = buildRequestExecutionOptions(createConfig({
      protocol: 'openai',
      reasoningEffort: 'none',
      timeout: 120_000,
    }), { streaming: true })

    expect(result.timeout).toEqual({
      firstChunkMs: 120_000,
      chunkMs: 120_000,
    })
  })

  it('allows long silent reasoning windows without imposing a total timeout', () => {
    const result = buildRequestExecutionOptions(createConfig({
      protocol: 'openai-responses',
      reasoningEffort: 'high',
      timeout: 120_000,
    }), { streaming: true })

    expect(result.timeout).toEqual({
      firstChunkMs: 900_000,
      chunkMs: 900_000,
    })
  })

  it('uses the same long-reasoning inactivity window for non-OpenAI thinking routes', () => {
    const result = buildRequestExecutionOptions(createConfig({
      provider: 'anthropic',
      protocol: 'anthropic',
      enableThinking: true,
      reasoningEffort: 'high',
      timeout: 120_000,
    }), { streaming: true })

    expect(result.timeout).toEqual({
      firstChunkMs: 900_000,
      chunkMs: 900_000,
    })
  })

  it('protects ChatGPT OAuth reasoning even when effort uses the provider default', () => {
    const result = buildRequestExecutionOptions(createConfig({
      provider: 'openai-oauth',
      protocol: 'openai-responses',
      reasoningEffort: undefined,
      timeout: 120_000,
    }), { streaming: true })

    expect(result.timeout).toEqual({
      firstChunkMs: 900_000,
      chunkMs: 900_000,
    })
  })

  it('retains the configured total timeout for non-streaming requests', () => {
    const result = buildRequestExecutionOptions(createConfig({ timeout: 120_000 }))
    expect(result.timeout).toBe(120_000)
  })
})
