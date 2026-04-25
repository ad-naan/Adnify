import { getBuiltinProvider } from './providers'
import { SETTINGS, type ProviderModelConfig } from './settings'
import type { ApiProtocol, ProviderConfig, PersistedLLMConfig, LLMConfig } from './types'
import { resolvePersistedLLMBehavior } from './llmPersistence'
import { resolveOpenAICompatibilityProfile } from './providers'

type ProviderConfigMap = Record<string, ProviderConfig | ProviderModelConfig | undefined>

interface ResolvedProviderTransportConfig {
  apiKey: string
  baseUrl?: string
  timeout?: number
  headers?: Record<string, string>
  protocol: ApiProtocol
  openAICompatibilityProfile?: LLMConfig['openAICompatibilityProfile']
  model?: string
}

function resolveProviderTransportConfig(
  providerId: string,
  providerConfigs: ProviderConfigMap,
  fallbackConfig?: Partial<LLMConfig>,
): ResolvedProviderTransportConfig {
  const defaults = SETTINGS.llmConfig.default
  const providerConfig = providerConfigs[providerId]
  const builtinProvider = getBuiltinProvider(providerId)

  const fallbackMatchesProvider =
    fallbackConfig?.provider === providerId || (!providerConfig && fallbackConfig?.provider == null)

  return {
    apiKey: providerConfig?.apiKey ?? (fallbackMatchesProvider ? fallbackConfig?.apiKey : undefined) ?? '',
    baseUrl: providerConfig?.baseUrl ?? builtinProvider?.baseUrl ?? (fallbackMatchesProvider ? fallbackConfig?.baseUrl : undefined) ?? defaults.baseUrl,
    timeout: providerConfig?.timeout ?? builtinProvider?.defaults.timeout ?? (fallbackMatchesProvider ? fallbackConfig?.timeout : undefined) ?? defaults.timeout,
    headers: providerConfig?.headers ?? (fallbackMatchesProvider ? fallbackConfig?.headers : undefined) ?? defaults.headers,
    protocol: providerConfig?.protocol ?? builtinProvider?.protocol ?? (fallbackMatchesProvider ? fallbackConfig?.protocol : undefined) ?? 'openai',
    openAICompatibilityProfile: resolveOpenAICompatibilityProfile(
      providerId,
      providerConfig?.protocol ?? builtinProvider?.protocol ?? (fallbackMatchesProvider ? fallbackConfig?.protocol : undefined) ?? 'openai',
      providerConfig?.openAICompatibilityProfile
        ?? (fallbackMatchesProvider ? fallbackConfig?.openAICompatibilityProfile : undefined),
    ),
    model: providerConfig?.model ?? builtinProvider?.defaultModel ?? (fallbackMatchesProvider ? fallbackConfig?.model : undefined),
  }
}

export function resolveRuntimeLLMConfig(
  saved: Partial<PersistedLLMConfig> | undefined,
  providerConfigs: ProviderConfigMap,
): LLMConfig {
  const defaults = SETTINGS.llmConfig.default
  const providerId = saved?.provider ?? defaults.provider
  const transport = resolveProviderTransportConfig(providerId, providerConfigs)
  const behavior = resolvePersistedLLMBehavior(saved, defaults)

  return {
    provider: providerId,
    model: saved?.model ?? transport.model ?? defaults.model,
    apiKey: transport.apiKey,
    baseUrl: transport.baseUrl,
    timeout: transport.timeout,
    ...behavior,
    headers: transport.headers,
    protocol: transport.protocol,
    openAICompatibilityProfile: transport.openAICompatibilityProfile,
  }
}

export function resolveTaskLLMConfig(
  providerId: string,
  modelId: string,
  providerConfigs: ProviderConfigMap,
  activeConfig?: Partial<LLMConfig>,
): LLMConfig | null {
  const defaults = SETTINGS.llmConfig.default
  const transport = resolveProviderTransportConfig(providerId, providerConfigs, activeConfig)

  if (!transport.apiKey) {
    return null
  }

  return {
    ...defaults,
    ...activeConfig,
    provider: providerId,
    model: modelId,
    apiKey: transport.apiKey,
    baseUrl: transport.baseUrl,
    timeout: transport.timeout,
    headers: transport.headers,
    protocol: transport.protocol,
    openAICompatibilityProfile: transport.openAICompatibilityProfile,
  }
}
