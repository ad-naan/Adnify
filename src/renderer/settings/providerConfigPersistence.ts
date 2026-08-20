import type { ProviderModelConfig } from '@shared/config/settings'
import type { LLMConfig } from '@shared/config/types'

/** Capture provider-owned fields before saving or switching the active provider. */
export function captureActiveProviderConfig(
  existing: ProviderModelConfig | undefined,
  active: LLMConfig,
): ProviderModelConfig {
  return {
    ...existing,
    apiKey: active.apiKey,
    baseUrl: active.baseUrl,
    timeout: active.timeout,
    model: active.model,
    headers: active.headers,
    capabilities: active.capabilities,
    openAICompatibilityProfile: active.openAICompatibilityProfile,
    protocol: active.protocol,
  }
}
