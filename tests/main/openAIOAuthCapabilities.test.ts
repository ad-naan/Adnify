import { describe, expect, it, vi } from 'vitest'
import type { LLMConfig } from '@shared/types'
import { getOpenAIOAuthModels } from '@shared/config/providers'

const auth = vi.hoisted(() => ({
  getValidToken: vi.fn(async () => 'oauth-access'),
  getStatus: vi.fn(async () => ({
    loggedIn: true,
    accountID: 'account-1',
    planType: 'plus',
  })),
  refreshAfterUnauthorized: vi.fn(),
}))

vi.mock('@main/services/openai/OpenAIAuthService', () => ({ OpenAIAuthService: auth }))

import { resolveAuthForConfig } from '@main/services/llm/modelFactory'

function config(overrides: Partial<LLMConfig>): LLMConfig {
  return {
    provider: 'openai-oauth',
    model: 'gpt-5.6-terra',
    apiKey: '',
    protocol: 'openai-responses',
    ...overrides,
  }
}

describe('ChatGPT OAuth capabilities and routing', () => {
  it('advertises Spark only for Pro accounts', () => {
    expect(getOpenAIOAuthModels('plus')).not.toContain('gpt-5.3-codex-spark')
    expect(getOpenAIOAuthModels('business')).not.toContain('gpt-5.3-codex-spark')
    expect(getOpenAIOAuthModels('pro')).toContain('gpt-5.3-codex-spark')
  })

  it('pins OAuth traffic to the ChatGPT backend and falls back from an unavailable model', async () => {
    const resolved = await resolveAuthForConfig(config({
      baseUrl: 'https://attacker.invalid/v1',
      model: 'gpt-5.3-codex-spark',
    }))

    expect(resolved.baseUrl).toBe('https://chatgpt.com/backend-api/codex')
    expect(resolved.baseUrl).not.toContain('attacker.invalid')
    expect(resolved.model).not.toBe('gpt-5.3-codex-spark')
    expect(resolved.headers).toMatchObject({
      'chatgpt-account-id': 'account-1',
      originator: 'adnify',
    })
  })

  it('does not silently route a normal OpenAI provider through ChatGPT OAuth', async () => {
    auth.getValidToken.mockClear()
    await expect(resolveAuthForConfig(config({
      provider: 'openai',
      model: 'gpt-5.6-sol',
      apiKey: '',
      protocol: 'openai-responses',
    }))).rejects.toThrow()
    expect(auth.getValidToken).not.toHaveBeenCalled()
  })
})
