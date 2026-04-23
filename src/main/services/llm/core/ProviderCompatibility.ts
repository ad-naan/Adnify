import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { LLMConfig, LLMMessage } from '@shared/types'
import { resolveCacheProtocol } from './cacheProtocol'

export type RequestProviderOptions = ProviderOptions

export interface ThinkingCompatibilityDecision {
  enabled: boolean
}

export function usesAnthropicProtocol(config: LLMConfig): boolean {
  return config.provider === 'anthropic' || config.protocol === 'anthropic'
}

export function usesOpenAIProtocol(config: LLMConfig): boolean {
  const protocol = resolveCacheProtocol(config.protocol, config.provider)
  return protocol === 'openai' || protocol === 'openai-responses'
}

export function resolveThinkingCompatibility(
  config: LLMConfig,
  _messages: LLMMessage[] = [],
): ThinkingCompatibilityDecision {
  return { enabled: Boolean(config.enableThinking) }
}

export function buildThinkingProviderOptions(config: LLMConfig): RequestProviderOptions | undefined {
  const protocol = config.protocol || ''

  if (config.provider === 'gemini' || protocol === 'google') {
    const isGemini3 = /gemini-3/i.test(config.model)
    return {
      google: {
        thinkingConfig: isGemini3
          ? { thinkingLevel: config.reasoningEffort || 'medium', includeThoughts: true }
          : { thinkingBudget: config.thinkingBudget || 10000, includeThoughts: true },
      },
    }
  }

  if (usesAnthropicProtocol(config)) {
    return {
      anthropic: {
        thinking: {
          type: 'enabled',
          budgetTokens: config.thinkingBudget || 10000,
        },
      },
    }
  }

  return {
    openai: {
      reasoningEffort: config.reasoningEffort || 'medium',
      reasoningSummary: 'detailed',
    },
  }
}

export function buildProtocolProviderOptions(config: LLMConfig): RequestProviderOptions | undefined {
  let providerOptions: RequestProviderOptions | undefined

  if (usesOpenAIProtocol(config) && config.parallelToolCalls !== undefined) {
    const parallelToolCalls = { parallelToolCalls: config.parallelToolCalls }
    providerOptions = mergeProviderOptions(providerOptions, {
      openai: parallelToolCalls,
      openaiCompatible: parallelToolCalls,
      'custom-openai': parallelToolCalls,
      custom: parallelToolCalls,
    })
  }

  return providerOptions
}

export function mergeProviderOptions(
  base: RequestProviderOptions | undefined,
  extra: RequestProviderOptions | undefined,
): RequestProviderOptions | undefined {
  if (!extra) return base

  const result: RequestProviderOptions = { ...(base ?? {}) }
  for (const [key, value] of Object.entries(extra)) {
    result[key] = {
      ...(result[key] ?? {}),
      ...value,
    }
  }
  return result
}
