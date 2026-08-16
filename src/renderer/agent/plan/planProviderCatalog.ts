import { useStore } from '@/renderer/store'
import { BUILTIN_PROVIDERS } from '@/shared/config/providers'

export interface PlanProviderOption {
  id: string
  displayName: string
  models: string[]
  defaultModel: string
}

function unique(values: Array<string | undefined>) {
  return Array.from(new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value))))
}

/** Providers safe for Plan task assignment: authenticated and model-complete. */
export function getConfiguredPlanProviders(): PlanProviderOption[] {
  const { providerConfigs, llmConfig } = useStore.getState()
  const options = new Map<string, PlanProviderOption>()

  for (const [id, config] of Object.entries(providerConfigs)) {
    const isCurrentRoute = llmConfig.provider === id && Boolean(llmConfig.apiKey?.trim())
    if (!config.apiKey?.trim() && !isCurrentRoute) continue
    const builtin = BUILTIN_PROVIDERS[id]
    const models = unique([config.model, ...(config.customModels || []), ...(builtin?.models || [])])
    if (models.length === 0) continue
    if (!builtin && !config.baseUrl?.trim() && !(isCurrentRoute && llmConfig.baseUrl?.trim())) continue
    options.set(id, {
      id,
      displayName: config.displayName?.trim() || builtin?.displayName || id,
      models,
      defaultModel: config.model?.trim() || (isCurrentRoute ? llmConfig.model : '') || builtin?.defaultModel || models[0],
    })
  }

  if (llmConfig.apiKey?.trim() && llmConfig.provider && llmConfig.model) {
    const id = llmConfig.provider
    const builtin = BUILTIN_PROVIDERS[id]
    const config = providerConfigs[id]
    const existing = options.get(id)
    const models = unique([llmConfig.model, ...(existing?.models || []), ...(config?.customModels || []), ...(builtin?.models || [])])
    options.set(id, {
      id,
      displayName: config?.displayName?.trim() || builtin?.displayName || id,
      models,
      defaultModel: llmConfig.model,
    })
  }

  const values = Array.from(options.values())
  return values.sort((a, b) => {
    if (a.id === llmConfig.provider) return -1
    if (b.id === llmConfig.provider) return 1
    return a.displayName.localeCompare(b.displayName)
  })
}

export function resolvePlanProviderAssignment(providerId?: string, modelId?: string) {
  const providers = getConfiguredPlanProviders()
  const provider = providers.find(item => item.id === providerId) || providers[0]
  if (!provider) return null
  const model = modelId && provider.models.includes(modelId) ? modelId : provider.defaultModel
  return { provider: provider.id, model, reassigned: provider.id !== providerId || model !== modelId }
}

export function getPlanProviderDisplayName(providerId: string): string {
  const { providerConfigs } = useStore.getState()
  return providerConfigs[providerId]?.displayName?.trim() || BUILTIN_PROVIDERS[providerId]?.displayName || providerId
}

export function buildPlanProviderPromptSection(): string | null {
  const providers = getConfiguredPlanProviders()
  if (!providers.length) return null
  return [
    '## Configured Plan Task Providers',
    'Only assign providers and models listed below. They have usable authentication and complete model configuration.',
    ...providers.map(provider => `- ${provider.id} (${provider.displayName}): ${provider.models.join(', ')}`),
    'Never invent a provider ID, select an unconfigured builtin provider, or assign a model outside its provider list.',
  ].join('\n')
}
