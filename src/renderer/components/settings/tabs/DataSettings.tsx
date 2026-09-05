import { t, type Language } from '@shared/i18n'
import { Button, Switch } from '@components/ui'
import { useState, useRef, useEffect } from 'react'
import { HardDrive, AlertTriangle, Download, Upload } from 'lucide-react'
import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { toast } from '@components/common/ToastProvider'
import { globalConfirm } from '@components/common/ConfirmDialog'
import { useStore } from '@store'
import { downloadSettings, importSettings, settingsService } from '@renderer/settings'
import { importUserPreferences, resetUserPreferences } from '@/renderer/services/preferenceService'
import { Agent } from '@/renderer/agent/core'
import { memoryService } from '@/renderer/agent/services/memoryService'
import { runCacheCleanupPhase } from '@renderer/services/cacheLifecycleService'
import { resolveRuntimeModelRoutingConfig } from '@shared/config/modelRouting'
import type { ProviderModelConfig, SettingsState } from '@shared/config/settings'
import { DEFAULT_NOTIFICATION_SETTINGS } from '@shared/types/notifications'
function DataPathDisplay() {
  const [path, setPath] = useState('')
  useEffect(() => {
    api.settings.getConfigPath?.().then(setPath)
  }, [])
  return <span>{path || '...'}</span>
}
export function DataSettings({ language }: { language: Language }) {
  const [isClearing, setIsClearing] = useState(false)
  const [includeApiKeys, setIncludeApiKeys] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const getStore = () => useStore.getState()
  const getCurrentSettings = (): SettingsState => {
    const cached = settingsService.getCache()
    if (cached) return cached

    // 如果缓存不存在，从 store 构建
    return {
      llmConfig: getStore().llmConfig,
      modelRouting: getStore().modelRouting,
      language: getStore().language,
      autoApprove: getStore().autoApprove,
      promptTemplateId: getStore().promptTemplateId,
      providerConfigs: getStore().providerConfigs,
      agentConfig: getStore().agentConfig,
      editorConfig: getStore().editorConfig,
      securitySettings: getStore().securitySettings,
      webSearchConfig: getStore().webSearchConfig,
      mcpConfig: getStore().mcpConfig,
      githubToken: getStore().githubToken,
      aiInstructions: getStore().aiInstructions,
      onboardingCompleted: getStore().onboardingCompleted,
      enableFileLogging: getStore().enableFileLogging,
      proxySettings: getStore().proxySettings,
    }
  }

  const handleExport = async () => {
    try {
      await downloadSettings(getCurrentSettings(), includeApiKeys)
      toast.success(t('systemSettings.settingsExported', language))
    } catch (error) {
      logger.settings.error('Failed to export settings:', error)
      toast.error(t('systemSettings.exportFailed', language))
    }
  }

  const handleImport = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const result = importSettings(text)

      if (!result.success || !result.settings) {
        toast.error(result.error || t('common.importFailed', language))
        return
      }

      const settings = result.settings

      if (result.userPreferences) {
        await importUserPreferences(result.userPreferences)
      }

      // 应用导入的设置
      if (settings.language) getStore().set('language', settings.language as 'en' | 'zh')
      if (settings.autoApprove) getStore().set('autoApprove', settings.autoApprove)
      if (settings.promptTemplateId) getStore().set('promptTemplateId', settings.promptTemplateId)
      if (settings.agentConfig) getStore().set('agentConfig', settings.agentConfig)
      if (settings.aiInstructions !== undefined) getStore().set('aiInstructions', settings.aiInstructions)

      // 应用 provider 配置
      if (settings.providerConfigs) {
        for (const [id, config] of Object.entries(settings.providerConfigs)) {
          getStore().setProvider(id, config as ProviderModelConfig)
        }
      }

      // 应用 LLM 配置
      if (settings.llmConfig) {
        getStore().update('llmConfig', {
          provider: settings.llmConfig.provider || getStore().llmConfig.provider,
          model: settings.llmConfig.model || getStore().llmConfig.model,
        })
      }

      if (settings.modelRouting) {
        const currentLlmConfig = getStore().llmConfig
        const routing = resolveRuntimeModelRoutingConfig(settings.modelRouting, {
          provider: currentLlmConfig.provider,
          model: currentLlmConfig.model,
        })
        getStore().set('modelRouting', routing)
      }

      if (settings.proxySettings) {
        getStore().set('proxySettings', settings.proxySettings)
      }

      // 保存设置到持久化存储
      await getStore().save()

      toast.success(t('systemSettings.settingsImported', language))
    } catch (error) {
      logger.settings.error('Failed to import settings:', error)
      toast.error(t('common.importFailed', language))
    }

    // 清空 input
    e.target.value = ''
  }

  const handleClearCache = async () => {
    setIsClearing(true)
    try {
      await runCacheCleanupPhase('manual')

      const wsPath = getStore().workspacePath
      if (wsPath) {
        try {
          await api.index.clear(wsPath)
        } catch {
          /* Continue clearing the other workspace indexes if one is unavailable. */
        }
      }

      Agent.clearSession()
      memoryService.clearCache()

      toast.success(t('systemSettings.cacheCleared', language))
    } catch (error) {
      logger.settings.error('Failed to clear cache:', error)
      toast.error(t('systemSettings.failedToClearCache', language))
    } finally {
      setIsClearing(false)
    }
  }

  const handleDeepClearCache = async () => {
    setIsClearing(true)
    try {
      await api.settings.deepCleanCache()
      toast.success(t('systemSettings.deepCacheCleared', language))
    } catch (error) {
      logger.settings.error('Failed to deep clear cache:', error)
      toast.error(t('systemSettings.deepClearFailed', language))
    } finally {
      setIsClearing(false)
    }
  }

  const handleReset = async () => {
    const confirmed = await globalConfirm({
      title: t('systemSettings.resetSettings', language),
      message: t('systemSettings.areYouSureYou', language),
      variant: 'danger',
    })
    if (confirmed) {
      // Factory reset must also remove previously enabled external destinations.
      await api.notifications.saveSettings(structuredClone(DEFAULT_NOTIFICATION_SETTINGS))
      // 清除所有持久化数据
      await Promise.all([
        api.settings.set('app-settings', undefined),
        api.settings.set('editorConfig', undefined),
        api.settings.set('securitySettings', undefined),
        resetUserPreferences(),
      ])
      localStorage.clear()
      window.location.reload()
    }
  }
  return (
    <div className="space-y-6 animate-fade-in pb-10">
      <section>
        <div className="flex items-center gap-2 mb-3 ml-1">
          <HardDrive className="w-4 h-4 text-accent" />
          <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-[0.14em]">
            {t('systemSettings.storageCache', language)}
          </h4>
        </div>
        <div className="space-y-4">
          <div className="rounded-xl border border-border/70 bg-surface/25 p-5 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-text-primary">
                  {t('systemSettings.configStoragePath', language)}
                </div>
                <div className="text-xs text-text-muted mt-1 opacity-70">
                  {t('systemSettings.storageLocationForAll', language)}
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="rounded-xl px-4"
                onClick={async () => {
                  const newPath = await api.file.selectFolder()
                  if (newPath) {
                    const result = await api.settings.setConfigPathDetailed(newPath)
                    if (result.success) {
                      toast.success(t('systemSettings.pathUpdatedRestartRequired', language))
                    } else {
                      toast.error(t('systemSettings.failedToUpdatePath', language), result.error.message)
                    }
                  }
                }}
              >
                {t('systemSettings.changePath', language)}
              </Button>
            </div>

            <div className="flex items-center gap-3 p-4 bg-background/50 rounded-xl border border-border shadow-inner">
              <div className="p-1.5 bg-white/5 rounded-lg">
                <HardDrive className="w-4 h-4 text-text-muted" />
              </div>
              <div className="text-xs text-text-secondary font-mono break-all opacity-90">
                <DataPathDisplay />
              </div>
            </div>

            <div className="flex items-center gap-2 text-[10px] font-medium text-yellow-500 bg-yellow-500/10 px-3 py-2 rounded-lg border border-yellow-500/20">
              <AlertTriangle className="w-3.5 h-3.5" />
              {t('systemSettings.restartApplicationManuallyAfter', language)}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border/70 bg-surface/25 p-5">
            <div>
              <div className="text-sm font-bold text-text-primary">{t('systemSettings.clearCache', language)}</div>
              <div className="text-xs text-text-muted mt-1 opacity-70">
                {t('systemSettings.clearAppCachesIndex', language)}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleClearCache}
                disabled={isClearing}
                className="rounded-xl px-6"
              >
                {isClearing ? t('systemSettings.clearing', language) : t('common.clear', language)}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleDeepClearCache}
                disabled={isClearing}
                className="rounded-xl px-6"
              >
                {t('systemSettings.deepClean', language)}
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-red-500/20 bg-red-500/[0.07] p-5">
            <div>
              <div className="text-sm font-bold text-red-400">{t('systemSettings.resetAllSettings', language)}</div>
              <div className="text-xs text-red-400/70 mt-1">
                {t('systemSettings.restoreFactorySettingsIrreversible', language)}
              </div>
            </div>
            <Button variant="danger" size="sm" onClick={handleReset} className="rounded-xl px-6">
              {t('common.reset2', language)}
            </Button>
          </div>
        </div>
      </section>
      <section>
        <div className="flex items-center gap-2 mb-3 ml-1">
          <Download className="w-4 h-4 text-accent" />
          <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-[0.14em]">
            {t('systemSettings.settingsBackup', language)}
          </h4>
        </div>
        <div className="space-y-4">
          <div className="rounded-xl border border-border/70 bg-surface/25 p-5 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-text-primary">
                  {t('systemSettings.exportSettings', language)}
                </div>
                <div className="text-xs text-text-muted mt-1 opacity-70">
                  {t('systemSettings.exportCurrentSettingsTo', language)}
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={handleExport} className="rounded-xl px-4">
                <Download className="w-3.5 h-3.5 mr-1.5" />
                {t('exportSession', language)}
              </Button>
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="text-xs text-text-muted">{t('systemSettings.includeApiKeysNot', language)}</div>
              <Switch checked={includeApiKeys} onChange={(e) => setIncludeApiKeys(e.target.checked)} />
            </div>

            {includeApiKeys && (
              <div className="flex items-center gap-2 text-[10px] font-medium text-yellow-500 bg-yellow-500/10 px-3 py-2 rounded-lg border border-yellow-500/20">
                <AlertTriangle className="w-3.5 h-3.5" />
                {t('systemSettings.exportedFileWillContain', language)}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border/70 bg-surface/25 p-5">
            <div>
              <div className="text-sm font-bold text-text-primary">{t('systemSettings.importSettings', language)}</div>
              <div className="text-xs text-text-muted mt-1 opacity-70">
                {t('systemSettings.importSettingsFromJson', language)}
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={handleImport} className="rounded-xl px-4">
              <Upload className="w-3.5 h-3.5 mr-1.5" />
              {t('common.import2', language)}
            </Button>
            <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileChange} className="hidden" />
          </div>
        </div>
      </section>
    </div>
  )
}
