import { describe, expect, it } from 'vitest'
import { convertUsage } from '@main/services/llm/types'

describe('convertUsage', () => {
  it('prefers AI SDK standard cache fields when available', () => {
    const usage = {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      inputTokenDetails: {
        cacheReadTokens: 60,
        cacheWriteTokens: 40,
      },
      outputTokenDetails: {
        reasoningTokens: 5,
      },
    } as any

    expect(convertUsage(usage)).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      cachedInputTokens: 60,
      cacheWriteTokens: 40,
      reasoningTokens: 5,
    })
  })

  it('falls back to anthropic raw cache fields', () => {
    const usage = {
      inputTokens: 180,
      outputTokens: 20,
      totalTokens: 200,
      inputTokenDetails: {
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
      },
      raw: {
        cache_read_input_tokens: 70,
        cache_creation_input_tokens: 30,
      },
    } as any

    expect(convertUsage(usage)).toEqual({
      inputTokens: 180,
      outputTokens: 20,
      totalTokens: 200,
      cachedInputTokens: 70,
      cacheWriteTokens: 30,
      reasoningTokens: undefined,
    })
  })

  it('falls back to openai and google raw cache read fields', () => {
    const openAIUsage = {
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      inputTokenDetails: {},
      raw: {
        input_tokens_details: {
          cached_tokens: 50,
        },
      },
    } as any

    const googleUsage = {
      inputTokens: 140,
      outputTokens: 25,
      totalTokens: 165,
      inputTokenDetails: {},
      raw: {
        cachedContentTokenCount: 45,
      },
    } as any

    expect(convertUsage(openAIUsage).cachedInputTokens).toBe(50)
    expect(convertUsage(openAIUsage).cacheWriteTokens).toBe(0)
    expect(convertUsage(googleUsage).cachedInputTokens).toBe(45)
    expect(convertUsage(googleUsage).cacheWriteTokens).toBe(0)
  })
})
