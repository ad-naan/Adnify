/**
 * Settings persistence service.
 *
 * Responsibilities:
 * - load settings from file/localStorage
 * - save settings to file/localStorage
 * - sync non-file side effects to the main process
 *
 * Architecture:
 * - `llmConfig` persistence only stores active model selection + generation behavior
 * - provider/network fields (apiKey/baseUrl/timeout/headers/protocol) live in `providerConfigs`
 * - runtime `LLMConfig` is reconstructed from persisted llmConfig + providerConfigs + defaults
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@shared/utils/Logger'
import {
  SETTINGS,
  type SettingsState,
  type SettingKey,
  type SettingValue,
  type ProviderModelConfig,
  getAllDefaults,
} from '@shared/config/settings'
import {
  isBuiltinProvider,
  getBuiltinProvider,
} from '@shared/config/providers'
import type {
  ProviderConfig,
  LLMConfig,
  PersistedLLMConfig,
} from '@shared/config/types'

const STORAGE_KEYS = {
  APP: 'app-settings',
  EDITOR: 'editorConfig',
  SECURITY: 'securitySettings',
} as const

const LOCAL_CACHE_KEY = 'adnify-settings-cache'

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target }

  for (const key in source) {
    if (source[key] === undefined) continue

    const sourceValue = source[key]
    const targetValue = target[key]

    if (
      typeof sourceValue === 'object' &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === 'object' &&
      targetValue !== null
    ) {
      ;(result as Record<string, unknown>)[key] = deepMerge(
        targetValue as object,
        sourceValue as object,
      )
      continue
    }

    ;(result as Record<string, unknown>)[key] = sourceValue
  }

  return result
}

function cleanProviderConfig(
  providerId: string,
  config: ProviderConfig,
  isCurrentProvider: boolean,
): Partial<ProviderConfig> | null {
  const builtinDef = getBuiltinProvider(providerId)
  const cleaned: Partial<ProviderConfig> = {}

  if (config.apiKey) cleaned.apiKey = config.apiKey

  if (config.baseUrl && config.baseUrl !== builtinDef?.baseUrl) {
    cleaned.baseUrl = config.baseUrl
  }

  if (isCurrentProvider && config.model) cleaned.model = config.model

  if (
    typeof config.timeout === 'number' &&
    config.timeout > 0 &&
    config.timeout !== SETTINGS.llmConfig.default.timeout
  ) {
    cleaned.timeout = config.timeout
  }

  if (config.customModels?.length) cleaned.customModels = config.customModels
  if (config.headers && Object.keys(config.headers).length > 0) cleaned.headers = config.headers

  if (!isBuiltinProvider(providerId)) {
    if (config.displayName) cleaned.displayName = config.displayName
    if (config.protocol) cleaned.protocol = config.protocol
    if (config.createdAt) cleaned.createdAt = config.createdAt
    if (config.updatedAt) cleaned.updatedAt = config.updatedAt
    if (config.baseUrl) cleaned.baseUrl = config.baseUrl
  }

  return Object.keys(cleaned).length > 0 ? cleaned : null
}

function mergeProviderConfigs(
  saved: Record<string, ProviderConfig> | undefined,
): Record<string, ProviderModelConfig> {
  const defaults = SETTINGS.providerConfigs.default
  if (!saved) return { ...defaults }

  const merged: Record<string, ProviderModelConfig> = { ...defaults }

  for (const [id, config] of Object.entries(saved)) {
    if (isBuiltinProvider(id)) {
      merged[id] = { ...defaults[id], ...config }
      continue
    }

    merged[id] = { ...config }
  }

  return merged
}

function serializeLLMConfig(config: LLMConfig): PersistedLLMConfig {
  return {
    provider: config.provider,
    model: config.model,
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
    enableThinking: config.enableThinking,
    thinkingBudget: config.thinkingBudget,
    reasoningEffort: config.reasoningEffort,
  }
}

function buildPersistedSettingsPayload(
  settings: SettingsState,
  providerConfigs: Record<string, unknown>,
) {
  return {
    llmConfig: serializeLLMConfig(settings.llmConfig),
    language: settings.language,
    autoApprove: settings.autoApprove,
    promptTemplateId: settings.promptTemplateId,
    agentConfig: settings.agentConfig,
    providerConfigs,
    aiInstructions: settings.aiInstructions,
    onboardingCompleted: settings.onboardingCompleted,
    webSearchConfig: settings.webSearchConfig,
    mcpConfig: settings.mcpConfig,
    enableFileLogging: settings.enableFileLogging,
  }
}

function mergeLLMConfig(
  saved: Partial<PersistedLLMConfig> | undefined,
  providerConfigs: Record<string, ProviderModelConfig>,
): LLMConfig {
  const defaults = SETTINGS.llmConfig.default
  if (!saved) return defaults

  const providerId = saved.provider ?? defaults.provider
  const providerConfig = providerConfigs[providerId] ?? {}
  const builtinDef = getBuiltinProvider(providerId)

  return {
    provider: providerId,
    model: saved.model ?? providerConfig.model ?? builtinDef?.defaultModel ?? defaults.model,
    apiKey: providerConfig.apiKey ?? defaults.apiKey,
    baseUrl: providerConfig.baseUrl ?? builtinDef?.baseUrl ?? defaults.baseUrl,
    timeout: providerConfig.timeout ?? builtinDef?.defaults.timeout ?? defaults.timeout,
    temperature: saved.temperature ?? defaults.temperature,
    maxTokens: saved.maxTokens ?? defaults.maxTokens,
    topP: saved.topP ?? defaults.topP,
    topK: saved.topK ?? defaults.topK,
    frequencyPenalty: saved.frequencyPenalty ?? defaults.frequencyPenalty,
    presencePenalty: saved.presencePenalty ?? defaults.presencePenalty,
    stopSequences: saved.stopSequences ?? defaults.stopSequences,
    seed: saved.seed ?? defaults.seed,
    logitBias: saved.logitBias ?? defaults.logitBias,
    maxRetries: saved.maxRetries ?? defaults.maxRetries,
    toolChoice: saved.toolChoice ?? defaults.toolChoice,
    parallelToolCalls: saved.parallelToolCalls ?? defaults.parallelToolCalls,
    headers: providerConfig.headers ?? defaults.headers,
    enableThinking: saved.enableThinking ?? defaults.enableThinking,
    thinkingBudget: saved.thinkingBudget ?? defaults.thinkingBudget,
    reasoningEffort: saved.reasoningEffort ?? defaults.reasoningEffort,
    protocol: providerConfig.protocol,
  }
}

class SettingsService {
  private cache: SettingsState | null = null

  async load(): Promise<SettingsState> {
    try {
      const cached = localStorage.getItem(LOCAL_CACHE_KEY)
      if (cached) {
        const parsed = JSON.parse(cached) as Record<string, unknown>
        const merged = this.merge(parsed)
        this.cache = merged
        this.syncFromFile()
        return merged
      }
    } catch {
      // ignore local cache corruption
    }

    try {
      const [appSettings, editorConfig, securitySettings] = await Promise.all([
        api.settings.get(STORAGE_KEYS.APP),
        api.settings.get(STORAGE_KEYS.EDITOR),
        api.settings.get(STORAGE_KEYS.SECURITY),
      ])

      const merged = this.merge({
        ...(appSettings as object || {}),
        editorConfig,
        securitySettings,
      })

      this.cache = merged
      this.saveToLocalStorage(merged)
      return merged
    } catch (error) {
      logger.settings.error('[SettingsService] Load failed:', error)
      return getAllDefaults()
    }
  }

  async save(settings: SettingsState): Promise<void> {
    try {
      const cleanedProviderConfigs: Record<string, ProviderConfig> = {}

      for (const [id, config] of Object.entries(settings.providerConfigs)) {
        const cleaned = cleanProviderConfig(id, config, id === settings.llmConfig.provider)
        if (cleaned) cleanedProviderConfigs[id] = cleaned as ProviderConfig
      }

      const appSettings = buildPersistedSettingsPayload(settings, cleanedProviderConfigs)

      this.cache = settings
      this.saveToLocalStorage(settings)

      await Promise.all([
        api.settings.set(STORAGE_KEYS.APP, appSettings),
        api.settings.set(STORAGE_KEYS.EDITOR, settings.editorConfig),
        api.settings.set(STORAGE_KEYS.SECURITY, settings.securitySettings),
      ])

      await this.syncToMain(settings)

      logger.settings.info('[SettingsService] Saved')
    } catch (error) {
      logger.settings.error('[SettingsService] Save failed:', error)
      throw error
    }
  }

  async saveSingle<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<void> {
    const current = this.cache || await this.load()
    await this.save({ ...current, [key]: value })
  }

  getCache(): SettingsState | null {
    return this.cache
  }

  clearCache(): void {
    this.cache = null
    try {
      localStorage.removeItem(LOCAL_CACHE_KEY)
    } catch {
      // ignore
    }
  }

  private merge(saved: Record<string, unknown>): SettingsState {
    const defaults = getAllDefaults()
    const providerConfigs = mergeProviderConfigs(
      saved.providerConfigs as Record<string, ProviderConfig> | undefined,
    )
    const llmConfig = mergeLLMConfig(
      saved.llmConfig as Partial<PersistedLLMConfig> | undefined,
      providerConfigs,
    )

    return {
      llmConfig,
      language: ((saved.language as string) || defaults.language) as 'en' | 'zh',
      autoApprove: { ...defaults.autoApprove, ...(saved.autoApprove as object || {}) },
      promptTemplateId: (saved.promptTemplateId as string) || defaults.promptTemplateId,
      providerConfigs: providerConfigs as Record<string, ProviderModelConfig>,
      agentConfig: { ...defaults.agentConfig, ...(saved.agentConfig as object || {}) },
      editorConfig: saved.editorConfig
        ? deepMerge(defaults.editorConfig, saved.editorConfig as object)
        : defaults.editorConfig,
      securitySettings: saved.securitySettings
        ? deepMerge(defaults.securitySettings, saved.securitySettings as object)
        : defaults.securitySettings,
      webSearchConfig: { ...defaults.webSearchConfig, ...(saved.webSearchConfig as object || {}) },
      mcpConfig: { ...defaults.mcpConfig, ...(saved.mcpConfig as object || {}) },
      aiInstructions: (saved.aiInstructions as string) || defaults.aiInstructions,
      onboardingCompleted: typeof saved.onboardingCompleted === 'boolean'
        ? saved.onboardingCompleted
        : defaults.onboardingCompleted,
      enableFileLogging: typeof saved.enableFileLogging === 'boolean'
        ? saved.enableFileLogging
        : defaults.enableFileLogging,
    }
  }

  private async syncFromFile(): Promise<void> {
    try {
      const [appSettings, editorConfig, securitySettings] = await Promise.all([
        api.settings.get(STORAGE_KEYS.APP),
        api.settings.get(STORAGE_KEYS.EDITOR),
        api.settings.get(STORAGE_KEYS.SECURITY),
      ])

      if (!appSettings && !editorConfig && !securitySettings) return

      const merged = this.merge({
        ...(appSettings as object || {}),
        editorConfig,
        securitySettings,
      })

      this.cache = merged
      this.saveToLocalStorage(merged)
    } catch {
      // ignore file refresh failures
    }
  }

  private saveToLocalStorage(settings: SettingsState): void {
    try {
      localStorage.setItem(
        LOCAL_CACHE_KEY,
        JSON.stringify(buildPersistedSettingsPayload(settings, settings.providerConfigs)),
      )
    } catch {
      // ignore local cache write failures
    }
  }

  private async syncToMain(settings: SettingsState): Promise<void> {
    const promises: Promise<unknown>[] = []

    if (settings.webSearchConfig.googleApiKey && settings.webSearchConfig.googleCx) {
      promises.push(
        api.http.setGoogleSearch(
          settings.webSearchConfig.googleApiKey,
          settings.webSearchConfig.googleCx,
        ),
      )
    }

    promises.push(api.mcp.setAutoConnect(settings.mcpConfig.autoConnect ?? true))

    await Promise.all(promises)
  }
}

export const settingsService = new SettingsService()

export function getEditorConfig(): SettingsState['editorConfig'] {
  return settingsService.getCache()?.editorConfig || SETTINGS.editorConfig.default
}

export function saveEditorConfig(config: Partial<SettingsState['editorConfig']>): void {
  const current = settingsService.getCache()
  if (!current) return

  const merged = deepMerge(current.editorConfig, config)
  settingsService.saveSingle('editorConfig', merged).catch((error) => {
    logger.settings.error('Failed to save editor config:', error)
  })
}

export function resetEditorConfig(): void {
  settingsService.saveSingle('editorConfig', SETTINGS.editorConfig.default).catch((error) => {
    logger.settings.error('Failed to reset editor config:', error)
  })
}
