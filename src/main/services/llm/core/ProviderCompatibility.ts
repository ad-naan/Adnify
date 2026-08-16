import type { JSONValue } from '@ai-sdk/provider'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { LLMConfig, LLMMessage } from '@shared/types'
import {
  isBuiltinProvider,
  isOpenAIStyleProtocol,
  supportsFullOpenAIStyleFeatures,
} from '@shared/config/providers'
import { resolveCacheProtocol } from './cacheProtocol'

export type RequestProviderOptions = ProviderOptions

export interface ThinkingCompatibilityDecision {
  enabled: boolean
}

const OPENAI_MANAGED_OPTION_KEYS = new Set([
  'instructions',
  'logitBias',
  'parallelToolCalls',
  'reasoningEffort',
  'reasoningSummary',
])

const ANTHROPIC_MANAGED_OPTION_KEYS = new Set([
  'thinking',
  'effort',
])

const GOOGLE_MANAGED_OPTION_KEYS = new Set([
  'thinkingConfig',
])

export function usesAnthropicProtocol(config: LLMConfig): boolean {
  return config.provider === 'anthropic' || config.protocol === 'anthropic'
}

export function usesOpenAIProtocol(config: LLMConfig): boolean {
  return isOpenAIStyleProtocol(resolveCacheProtocol(config.protocol, config.provider))
}

export function getOpenAIProviderOptionKeys(
  config: LLMConfig,
): readonly string[] {
  const protocol = resolveCacheProtocol(config.protocol, config.provider)

  if (protocol === 'openai-responses') {
    return ['openai']
  }

  if (protocol === 'openai' && isBuiltinProvider(config.provider) && config.provider === 'openai') {
    return ['openai']
  }

  if (protocol === 'openai') {
    return ['openaiCompatible', 'custom-openai']
  }

  return ['openaiCompatible']
}

function usesOpenAIResponsesProtocol(config: LLMConfig): boolean {
  return resolveCacheProtocol(config.protocol, config.provider) === 'openai-responses'
}

function supportsFullOpenAIProfile(config: LLMConfig): boolean {
  return supportsFullOpenAIStyleFeatures(
    config.provider,
    resolveCacheProtocol(config.protocol, config.provider),
    config.openAICompatibilityProfile,
  )
}

export function resolveThinkingCompatibility(
  config: LLMConfig,
  _messages: LLMMessage[] = [],
): ThinkingCompatibilityDecision {
  return { enabled: Boolean(config.enableThinking) }
}

export function buildOpenAIStyleProviderOptions(
  config: LLMConfig,
  options: Record<string, unknown>,
): RequestProviderOptions {
  return Object.fromEntries(
    getOpenAIProviderOptionKeys(config).map(key => [key, options]),
  ) as RequestProviderOptions
}

export function buildThinkingProviderOptions(config: LLMConfig): RequestProviderOptions | undefined {
  const protocol = resolveCacheProtocol(config.protocol, config.provider)

  if (config.provider === 'gemini' || protocol === 'google') {
    const thinkingLevel = resolveGoogleThinkingLevel(config.reasoningEffort)
    const thinkingMode = config.capabilities?.googleThinkingMode ?? 'budget'
    return {
      google: {
        thinkingConfig: thinkingMode === 'level'
          ? {
              ...(thinkingLevel ? { thinkingLevel } : {}),
              includeThoughts: true,
            }
          : { thinkingBudget: config.thinkingBudget || 10000, includeThoughts: true },
      },
    }
  }

  if (usesAnthropicProtocol(config)) {
    const effort = resolveAnthropicEffort(config.reasoningEffort)
    return {
      anthropic: {
        thinking: {
          type: 'enabled',
          budgetTokens: config.thinkingBudget || 10000,
        },
        ...(effort ? { effort } : {}),
      },
    }
  }

  if (!usesOpenAIProtocol(config)) {
    return undefined
  }

  const reasoningEffort = supportsFullOpenAIProfile(config)
    ? resolveFullOpenAIReasoningEffort(config.reasoningEffort)
    : resolveCompatibleOpenAIReasoningEffort(
        config.reasoningEffort,
        config.capabilities?.openAICompatibleSupportsExtendedReasoningEffort,
      )

  if (!reasoningEffort) {
    return undefined
  }

  if (usesOpenAIResponsesProtocol(config) && supportsFullOpenAIProfile(config)) {
    const configuredReasoningSummary = config.providerOptions?.openai?.reasoningSummary
    return buildOpenAIStyleProviderOptions(config, {
      reasoningEffort,
      reasoningSummary: typeof configuredReasoningSummary === 'string'
        ? configuredReasoningSummary
        : 'detailed',
    })
  }

  return buildOpenAIStyleProviderOptions(config, { reasoningEffort })
}

export function buildProtocolProviderOptions(config: LLMConfig): RequestProviderOptions | undefined {
  let providerOptions = buildConfiguredProviderOptions(config)

  if (usesOpenAIProtocol(config) && typeof config.providerOptions?.openai?.instructions === 'string') {
    providerOptions = mergeProviderOptions(
      providerOptions,
      buildOpenAIStyleProviderOptions(config, {
        instructions: config.providerOptions.openai.instructions,
      }),
    )
  }

  if (usesOpenAIProtocol(config) && supportsFullOpenAIProfile(config) && config.parallelToolCalls !== undefined) {
    providerOptions = mergeProviderOptions(
      providerOptions,
      buildOpenAIStyleProviderOptions(config, { parallelToolCalls: config.parallelToolCalls }),
    )
  }

  if (usesOpenAIProtocol(config) && supportsFullOpenAIProfile(config) && config.logitBias) {
    providerOptions = mergeProviderOptions(
      providerOptions,
      buildOpenAIStyleProviderOptions(config, { logitBias: config.logitBias }),
    )
  }

  return providerOptions
}

function buildConfiguredProviderOptions(config: LLMConfig): RequestProviderOptions | undefined {
  let providerOptions: RequestProviderOptions | undefined

  if (usesOpenAIProtocol(config)) {
    const openAIOptions = omitManagedOptions(
      config.providerOptions?.openai,
      OPENAI_MANAGED_OPTION_KEYS,
    )

    if (openAIOptions) {
      providerOptions = mergeProviderOptions(
        providerOptions,
        buildOpenAIStyleProviderOptions(config, openAIOptions),
      )
    }
  }

  if (usesAnthropicProtocol(config)) {
    const anthropicOptions = omitManagedOptions(
      config.providerOptions?.anthropic,
      ANTHROPIC_MANAGED_OPTION_KEYS,
    )

    if (anthropicOptions) {
      providerOptions = mergeProviderOptions(providerOptions, {
        anthropic: anthropicOptions,
      })
    }
  }

  if (config.provider === 'gemini' || config.protocol === 'google') {
    const googleOptions = omitManagedOptions(
      config.providerOptions?.google,
      GOOGLE_MANAGED_OPTION_KEYS,
    )

    if (googleOptions) {
      providerOptions = mergeProviderOptions(providerOptions, {
        google: googleOptions,
      })
    }
  }

  return providerOptions
}

function resolveFullOpenAIReasoningEffort(
  effort: LLMConfig['reasoningEffort'],
): 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
  switch (effort) {
    case 'none':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return effort
    default:
      return 'medium'
  }
}

function resolveCompatibleOpenAIReasoningEffort(
  effort: LLMConfig['reasoningEffort'],
  supportsExtendedEffort = false,
): 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined {
  switch (effort) {
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
      return effort
    // Third-party gateways rarely accept the newer top tiers; clamp to the
    // highest value the compatible subset defines unless explicitly enabled.
    case 'xhigh':
    case 'max':
      return supportsExtendedEffort ? effort : 'high'
    case 'none':
      return undefined
    default:
      return 'medium'
  }
}

function resolveGoogleThinkingLevel(
  effort: LLMConfig['reasoningEffort'],
): 'minimal' | 'low' | 'medium' | 'high' | undefined {
  switch (effort) {
    case 'high':
    case 'medium':
    case 'low':
    case 'minimal':
      return effort
    // Google tops out at 'high'; degrade rather than drop the setting.
    case 'xhigh':
    case 'max':
      return 'high'
    default:
      return undefined
  }
}

function resolveAnthropicEffort(
  effort: LLMConfig['reasoningEffort'],
): 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined {
  switch (effort) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return effort
    // Anthropic has no 'minimal' tier; map it onto the lowest real one.
    case 'minimal':
      return 'low'
    default:
      return undefined
  }
}

function omitManagedOptions(
  options: Record<string, unknown> | undefined,
  managedKeys: ReadonlySet<string>,
): Record<string, JSONValue> | undefined {
  if (!options || typeof options !== 'object') {
    return undefined
  }

  const filteredEntries = Object.entries(options).filter(([key]) => !managedKeys.has(key))
  return filteredEntries.length > 0
    ? Object.fromEntries(filteredEntries) as Record<string, JSONValue>
    : undefined
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
