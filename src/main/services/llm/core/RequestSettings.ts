import type { LLMConfig } from '@shared/types'
import { resolveHeaderPlaceholders } from '../modelFactory'
import { resolveCacheProtocol } from './cacheProtocol'

export interface GenerationSettings {
  maxOutputTokens?: number
  temperature?: number
  topP?: number
  topK?: number
  frequencyPenalty?: number
  presencePenalty?: number
  stopSequences?: string[]
  seed?: number
}

export interface RequestExecutionOptions {
  maxRetries?: number
  toolChoice?: LLMConfig['toolChoice']
  headers?: Record<string, string>
  timeout?: number
}

function normalizePositiveNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined
}

function normalizeNonNegativeInteger(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : undefined
}

function normalizeTopK(value: number | undefined): number | undefined {
  return normalizePositiveInteger(value)
}

function normalizeHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined

  const entries = Object.entries(headers).filter(([, value]) => typeof value === 'string')
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function isOpenAIReasoningModel(model: string): boolean {
  return /^(gpt-5|o1|o3|o4|computer-use-preview)/i.test(model)
}

function supportsOpenAINonReasoningParameters(model: string): boolean {
  return /^gpt-5\.(1|2)/i.test(model)
}

function supportsOpenAIReasoningSampling(config: LLMConfig): boolean {
  const protocol = resolveCacheProtocol(config.protocol, config.provider)

  if ((protocol === 'openai' || protocol === 'openai-responses') && isOpenAIReasoningModel(config.model)) {
    return config.reasoningEffort === 'none' && supportsOpenAINonReasoningParameters(config.model)
  }

  return true
}

export function buildGenerationSettings(config: LLMConfig): GenerationSettings {
  const supportsOpenAIReasoningExtras = supportsOpenAIReasoningSampling(config)
  const protocol = resolveCacheProtocol(config.protocol, config.provider)
  const isOpenAIReasoningRoute =
    (protocol === 'openai' || protocol === 'openai-responses') &&
    isOpenAIReasoningModel(config.model)
  const supportsFrequencyPenalties =
    protocol !== 'openai-responses' &&
    !isOpenAIReasoningRoute

  return {
    maxOutputTokens: normalizePositiveInteger(config.maxTokens),
    temperature: supportsOpenAIReasoningExtras ? config.temperature : undefined,
    topP: supportsOpenAIReasoningExtras ? config.topP : undefined,
    topK: normalizeTopK(config.topK),
    frequencyPenalty: supportsFrequencyPenalties ? config.frequencyPenalty : undefined,
    presencePenalty: supportsFrequencyPenalties ? config.presencePenalty : undefined,
    stopSequences: config.stopSequences?.length ? config.stopSequences : undefined,
    seed: normalizeNonNegativeInteger(config.seed),
  }
}

export function buildRequestExecutionOptions(config: LLMConfig): RequestExecutionOptions {
  return {
    maxRetries: normalizeNonNegativeInteger(config.maxRetries),
    toolChoice: config.toolChoice,
    headers: normalizeHeaders(resolveHeaderPlaceholders(config.headers, config.apiKey)),
    timeout: normalizePositiveNumber(config.timeout),
  }
}
