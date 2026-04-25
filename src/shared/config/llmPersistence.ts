import type { LLMConfig, LLMProviderOptions } from '@/shared/types/llm'
import type { PersistedLLMConfig } from './types'

export const REASONING_EFFORT_VALUES = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sanitizeJsonValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }

  if (Array.isArray(value)) {
    return value
      .map(item => sanitizeJsonValue(item))
      .filter(item => item !== undefined)
  }

  if (!isRecord(value)) {
    return undefined
  }

  const cleaned: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const sanitized = sanitizeJsonValue(entry)
    if (sanitized !== undefined) {
      cleaned[key] = sanitized
    }
  }

  return cleaned
}

export function sanitizeProviderOptions(value: unknown): LLMProviderOptions | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const cleaned: LLMProviderOptions = {}

  for (const key of ['openai', 'anthropic', 'google'] as const) {
    const candidate = sanitizeJsonValue(value[key])
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      cleaned[key] = candidate as Record<string, unknown>
    }
  }

  return Object.keys(cleaned).length > 0 ? cleaned : undefined
}

export function sanitizeToolChoice(value: unknown): PersistedLLMConfig['toolChoice'] | undefined {
  if (value === 'auto' || value === 'none' || value === 'required') {
    return value
  }

  if (!isRecord(value)) {
    return undefined
  }

  return value.type === 'tool' && typeof value.toolName === 'string'
    ? { type: 'tool', toolName: value.toolName }
    : undefined
}

export function sanitizePersistedLLMConfig(value: unknown): Partial<PersistedLLMConfig> | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const cleaned: Partial<PersistedLLMConfig> = {}

  if (typeof value.provider === 'string') cleaned.provider = value.provider
  if (typeof value.model === 'string') cleaned.model = value.model
  if (typeof value.enableThinking === 'boolean') cleaned.enableThinking = value.enableThinking
  if (typeof value.thinkingBudget === 'number') cleaned.thinkingBudget = value.thinkingBudget
  if (typeof value.temperature === 'number') cleaned.temperature = value.temperature
  if (typeof value.maxTokens === 'number') cleaned.maxTokens = value.maxTokens
  if (typeof value.topP === 'number') cleaned.topP = value.topP
  if (typeof value.topK === 'number') cleaned.topK = value.topK
  if (typeof value.frequencyPenalty === 'number') cleaned.frequencyPenalty = value.frequencyPenalty
  if (typeof value.presencePenalty === 'number') cleaned.presencePenalty = value.presencePenalty
  if (typeof value.seed === 'number') cleaned.seed = value.seed
  if (typeof value.maxRetries === 'number') cleaned.maxRetries = value.maxRetries
  if (typeof value.parallelToolCalls === 'boolean') cleaned.parallelToolCalls = value.parallelToolCalls

  if (typeof value.reasoningEffort === 'string' && REASONING_EFFORT_VALUES.includes(value.reasoningEffort as typeof REASONING_EFFORT_VALUES[number])) {
    cleaned.reasoningEffort = value.reasoningEffort as PersistedLLMConfig['reasoningEffort']
  }

  if (Array.isArray(value.stopSequences)) {
    cleaned.stopSequences = value.stopSequences.filter((entry): entry is string => typeof entry === 'string')
  }

  if (isRecord(value.logitBias)) {
    const logitBias = Object.fromEntries(
      Object.entries(value.logitBias).filter(([, bias]) => typeof bias === 'number'),
    ) as Record<string, number>

    if (Object.keys(logitBias).length > 0) {
      cleaned.logitBias = logitBias
    }
  }

  const toolChoice = sanitizeToolChoice(value.toolChoice)
  if (toolChoice !== undefined) cleaned.toolChoice = toolChoice

  const providerOptions = sanitizeProviderOptions(value.providerOptions)
  if (providerOptions) cleaned.providerOptions = providerOptions

  return Object.keys(cleaned).length > 0 ? cleaned : undefined
}

export function serializePersistedLLMConfig(config: LLMConfig): PersistedLLMConfig {
  return {
    provider: config.provider,
    model: config.model,
    enableThinking: config.enableThinking,
    thinkingBudget: config.thinkingBudget,
    reasoningEffort: config.reasoningEffort,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    topP: config.topP,
    topK: config.topK,
    frequencyPenalty: config.frequencyPenalty,
    presencePenalty: config.presencePenalty,
    stopSequences: config.stopSequences,
    seed: config.seed,
    logitBias: config.logitBias,
    maxRetries: config.maxRetries,
    toolChoice: config.toolChoice,
    parallelToolCalls: config.parallelToolCalls,
    providerOptions: config.providerOptions,
  }
}

export function resolvePersistedLLMBehavior(
  saved: Partial<PersistedLLMConfig> | undefined,
  defaults: LLMConfig,
): Pick<
  LLMConfig,
  | 'enableThinking'
  | 'thinkingBudget'
  | 'reasoningEffort'
  | 'temperature'
  | 'maxTokens'
  | 'topP'
  | 'topK'
  | 'frequencyPenalty'
  | 'presencePenalty'
  | 'stopSequences'
  | 'seed'
  | 'logitBias'
  | 'maxRetries'
  | 'toolChoice'
  | 'parallelToolCalls'
  | 'providerOptions'
> {
  return {
    enableThinking: saved?.enableThinking ?? defaults.enableThinking,
    thinkingBudget: saved?.thinkingBudget ?? defaults.thinkingBudget,
    reasoningEffort: saved?.reasoningEffort ?? defaults.reasoningEffort,
    temperature: saved?.temperature ?? defaults.temperature,
    maxTokens: saved?.maxTokens ?? defaults.maxTokens,
    topP: saved?.topP ?? defaults.topP,
    topK: saved?.topK ?? defaults.topK,
    frequencyPenalty: saved?.frequencyPenalty ?? defaults.frequencyPenalty,
    presencePenalty: saved?.presencePenalty ?? defaults.presencePenalty,
    stopSequences: saved?.stopSequences ?? defaults.stopSequences,
    seed: saved?.seed ?? defaults.seed,
    logitBias: saved?.logitBias ?? defaults.logitBias,
    maxRetries: saved?.maxRetries ?? defaults.maxRetries,
    toolChoice: saved?.toolChoice ?? defaults.toolChoice,
    parallelToolCalls: saved?.parallelToolCalls ?? defaults.parallelToolCalls,
    providerOptions: saved?.providerOptions ?? defaults.providerOptions,
  }
}
