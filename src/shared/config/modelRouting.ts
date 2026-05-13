import type { LLMConfig, LLMMessage, MessageContent } from '@/shared/types/llm'
import type {
  ModelReference,
  ModelRoutingFallbackPolicy,
  ModelRoutingHandoffFormat,
  PersistedModelRoutingConfig,
  ResolvedModelRoutingConfig,
  MessageRoutingDecision,
  ProviderConfig,
} from './types'
import { resolveTaskLLMConfig } from './llmConfigResolver'

const DEFAULT_FALLBACK_POLICY: ModelRoutingFallbackPolicy = 'primary_with_notice'
const DEFAULT_HANDOFF_FORMAT: ModelRoutingHandoffFormat = 'structured_summary_with_raw_block'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sanitizeModelReference(value: unknown): ModelReference | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  return typeof value.provider === 'string' && typeof value.model === 'string' && value.provider && value.model
    ? {
        provider: value.provider,
        model: value.model,
      }
    : undefined
}

export function sanitizePersistedModelRoutingConfig(value: unknown): PersistedModelRoutingConfig | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const cleaned: PersistedModelRoutingConfig = {}
  const primary = sanitizeModelReference(value.primary)
  const multimodal = sanitizeModelReference(value.multimodal)

  if (typeof value.enabled === 'boolean') cleaned.enabled = value.enabled
  if (primary) cleaned.primary = primary
  if (multimodal) cleaned.multimodal = multimodal
  if (typeof value.fallbackPolicy === 'string' && value.fallbackPolicy) {
    cleaned.fallbackPolicy = value.fallbackPolicy as ModelRoutingFallbackPolicy
  }
  if (typeof value.handoffFormat === 'string' && value.handoffFormat) {
    cleaned.handoffFormat = value.handoffFormat as ModelRoutingHandoffFormat
  }

  return Object.keys(cleaned).length > 0 ? cleaned : undefined
}

export function resolveRuntimeModelRoutingConfig(
  saved: PersistedModelRoutingConfig | undefined,
  activeConfig: Pick<LLMConfig, 'provider' | 'model'>,
): ResolvedModelRoutingConfig {
  return {
    enabled: saved?.enabled ?? false,
    primary: {
      provider: activeConfig.provider,
      model: activeConfig.model,
    },
    multimodal: saved?.multimodal,
    fallbackPolicy: saved?.fallbackPolicy || DEFAULT_FALLBACK_POLICY,
    handoffFormat: saved?.handoffFormat || DEFAULT_HANDOFF_FORMAT,
  }
}

export function serializePersistedModelRoutingConfig(
  routingConfig: ResolvedModelRoutingConfig,
  activeConfig: Pick<LLMConfig, 'provider' | 'model'>,
): PersistedModelRoutingConfig {
  return {
    enabled: routingConfig.enabled,
    primary: {
      provider: activeConfig.provider,
      model: activeConfig.model,
    },
    multimodal: routingConfig.multimodal,
    fallbackPolicy: routingConfig.fallbackPolicy,
    handoffFormat: routingConfig.handoffFormat,
  }
}

export function createDefaultModelRoutingConfig(
  activeConfig: Pick<LLMConfig, 'provider' | 'model'>,
): ResolvedModelRoutingConfig {
  return resolveRuntimeModelRoutingConfig(undefined, activeConfig)
}

export function resolveModelConfigForRole(
  role: 'primary' | 'multimodal',
  routingConfig: ResolvedModelRoutingConfig,
  providerConfigs: Record<string, ProviderConfig | undefined>,
  activeConfig: LLMConfig,
): LLMConfig | null {
  if (role === 'primary') {
    return {
      ...activeConfig,
      provider: routingConfig.primary.provider,
      model: routingConfig.primary.model,
    }
  }

  const ref = routingConfig.multimodal
  if (!ref) {
    return null
  }

  return resolveTaskLLMConfig(ref.provider, ref.model, providerConfigs, activeConfig)
}

export function messageContentHasImages(content: MessageContent | null | undefined): boolean {
  return Array.isArray(content) && content.some(part => part.type === 'image')
}

export function resolveMessageRouting(
  messages: LLMMessage[],
  routingConfig: ResolvedModelRoutingConfig,
  providerConfigs: Record<string, ProviderConfig | undefined>,
  activeConfig: LLMConfig,
): MessageRoutingDecision {
  const primaryConfig = resolveModelConfigForRole('primary', routingConfig, providerConfigs, activeConfig) || activeConfig

  // If the user has not explicitly enabled multimodal routing, skip entirely.
  // The primary model will receive images as-is (works for models like gpt-4o, claude-sonnet, gemini).
  if (!routingConfig.enabled) {
    return {
      primaryConfig,
      shouldUseMultimodalPrepass: false,
      reason: 'no-config',
      fallbackPolicy: routingConfig.fallbackPolicy,
      handoffFormat: routingConfig.handoffFormat,
    }
  }

  const lastUserMessage = [...messages].reverse().find(message => message.role === 'user')

  if (!lastUserMessage || !messageContentHasImages(lastUserMessage.content)) {
    return {
      primaryConfig,
      shouldUseMultimodalPrepass: false,
      reason: 'no-image',
      fallbackPolicy: routingConfig.fallbackPolicy,
      handoffFormat: routingConfig.handoffFormat,
    }
  }

  const multimodalConfig = resolveModelConfigForRole('multimodal', routingConfig, providerConfigs, activeConfig)
  if (!multimodalConfig) {
    return {
      primaryConfig,
      shouldUseMultimodalPrepass: false,
      reason: 'no-config',
      fallbackPolicy: routingConfig.fallbackPolicy,
      handoffFormat: routingConfig.handoffFormat,
    }
  }

  // Short-circuit: if multimodal route points to the same provider+model as primary,
  // skip the prepass entirely — the primary model can handle images directly.
  if (multimodalConfig.provider === primaryConfig.provider && multimodalConfig.model === primaryConfig.model) {
    return {
      primaryConfig,
      shouldUseMultimodalPrepass: false,
      reason: 'same-model',
      fallbackPolicy: routingConfig.fallbackPolicy,
      handoffFormat: routingConfig.handoffFormat,
    }
  }

  return {
    primaryConfig,
    multimodalConfig,
    shouldUseMultimodalPrepass: true,
    reason: 'configured',
    fallbackPolicy: routingConfig.fallbackPolicy,
    handoffFormat: routingConfig.handoffFormat,
  }
}
