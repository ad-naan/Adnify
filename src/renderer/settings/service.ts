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
import { resolveRuntimeLLMConfig } from '@shared/config/llmConfigResolver'
import {
  isBuiltinProvider,
  getBuiltinProvider,
  getDefaultOpenAICompatibilityProfile,
  resolveOpenAICompatibilityProfile,
} from '@shared/config/providers'
import { serializePersistedLLMConfig } from '@shared/config/llmPersistence'
import type {
  ProviderConfig,
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
  const resolvedProtocol = config.protocol ?? builtinDef?.protocol
  const defaultOpenAIProfile = getDefaultOpenAICompatibilityProfile(providerId, resolvedProtocol)

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
  if (config.protocol && config.protocol !== builtinDef?.protocol) cleaned.protocol = config.protocol
  if (
    config.openAICompatibilityProfile &&
    config.openAICompatibilityProfile !== defaultOpenAIProfile
  ) {
    cleaned.openAICompatibilityProfile = config.openAICompatibilityProfile
  }

  if (!isBuiltinProvider(providerId)) {
    if (config.displayName) cleaned.displayName = config.displayName
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
      const resolved = { ...defaults[id], ...config }
      merged[id] = {
        ...resolved,
        openAICompatibilityProfile: resolveOpenAICompatibilityProfile(
          id,
          resolved.protocol ?? defaults[id]?.protocol,
          resolved.openAICompatibilityProfile,
        ),
      }
      continue
    }

    merged[id] = {
      ...config,
      openAICompatibilityProfile: resolveOpenAICompatibilityProfile(
        id,
        config.protocol,
        config.openAICompatibilityProfile,
      ),
    }
  }

  return merged
}

function buildPersistedSettingsPayload(
  settings: SettingsState,
  providerConfigs: Record<string, unknown>,
) {
  return {
    llmConfig: serializePersistedLLMConfig(settings.llmConfig),
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
    const llmConfig = resolveRuntimeLLMConfig(
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
