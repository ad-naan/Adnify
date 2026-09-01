/**
 * 系统设置组件
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useState, useEffect, useRef } from 'react'
import { HardDrive, AlertTriangle, Download, Upload, FileText, ExternalLink, Globe, BookOpen } from 'lucide-react'
import { toast } from '@components/common/ToastProvider'
import { globalConfirm } from '@components/common/ConfirmDialog'
import { Button, Switch } from '@components/ui'
import { Language, t } from '@shared/i18n'
import { useStore } from '@store'
import { downloadSettings, importSettings, settingsService } from '@renderer/settings'
import { importUserPreferences, resetUserPreferences } from '@/renderer/services/preferenceService'
import { Agent } from '@/renderer/agent/core'
import { memoryService } from '@/renderer/agent/services/memoryService'
import { runCacheCleanupPhase } from '@renderer/services/cacheLifecycleService'
import { resolveRuntimeModelRoutingConfig } from '@shared/config/modelRouting'
import type { ProviderModelConfig, SettingsState } from '@shared/config/settings'
import type { ProxyConfig } from '@shared/config/types'

interface SystemSettingsProps {
    language: Language
    enableFileLogging: boolean
    setEnableFileLogging: (enabled: boolean) => void
    githubToken: string
    setGithubToken: (token: string) => void
    proxySettings?: ProxyConfig
    setProxySettings: (settings: ProxyConfig) => void
}

function DataPathDisplay() {
    const [path, setPath] = useState('')
    useEffect(() => {
        // @ts-ignore
        api.settings.getConfigPath?.().then(setPath)
    }, [])
    return <span>{path || '...'}</span>
}

export function SystemSettings({
    language,
    enableFileLogging,
    setEnableFileLogging,
    githubToken,
    setGithubToken,
    proxySettings = { enabled: false, rules: '', bypassRules: '' },
    setProxySettings,
}: SystemSettingsProps) {
    const [isClearing, setIsClearing] = useState(false)
    const [includeApiKeys, setIncludeApiKeys] = useState(false)
    const [logPath, setLogPath] = useState('')
    const fileInputRef = useRef<HTMLInputElement>(null)
    const getStore = () => useStore.getState()

    const handleToggleProxy = (enabled: boolean) => {
        setProxySettings({
            ...proxySettings,
            enabled,
        })
    }

    const handleProxyRulesChange = (rules: string) => {
        setProxySettings({
            ...proxySettings,
            rules,
        })
    }

    const handleProxyBypassChange = (bypassRules: string) => {
        setProxySettings({
            ...proxySettings,
            bypassRules,
        })
    }

    // 获取日志文件路径
    useEffect(() => {
        const getLogPath = async () => {
            try {
                const userDataPath = await api.settings.getUserDataPath()
                if (userDataPath) {
                    setLogPath(`${userDataPath}/logs/main.log`)
                }
            } catch (err) {
                logger.settings.error('Failed to get log path:', err)
            }
        }
        getLogPath()
    }, [])

    const handleToggleFileLogging = (enabled: boolean) => {
        setEnableFileLogging(enabled)
    }

    // 构建当前设置对象（直接从 settingsService 缓存获取）
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
                toast.error(result.error || (t('common.importFailed', language)))
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
                } catch { }
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

    const handleOpenLogFile = async () => {
        if (!logPath) return
        const shown = await api.file.showInFolder(logPath)
        if (!shown) toast.error(t('systemSettings.couldNotLocateThe', language))
    }

    const handleExportLogs = async () => {
        try {
            const logs = await api.settings.getRecentLogs()
            if (logs) {
                const blob = new Blob([logs], { type: 'text/plain' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `adnify-logs-${new Date().toISOString().slice(0, 10)}.log`
                a.click()
                URL.revokeObjectURL(url)
                toast.success(t('systemSettings.logsExported', language))
            } else {
                toast.error(t('systemSettings.noLogsToExport', language))
            }
        } catch (err) {
            logger.settings.error('Failed to export logs:', err)
            toast.error(t('systemSettings.failedToExportLogs', language))
        }
    }

    return (
        <div className="space-y-6 animate-fade-in pb-10">
            <section>
                <div className="flex items-center gap-2 mb-3 ml-1">
                    <ExternalLink className="w-4 h-4 text-accent" />
                    <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-[0.14em]">
                        {t('systemSettings.githubIntegration', language)}
                    </h4>
                </div>
                <div className="space-y-4">
                    <div className="rounded-xl border border-border/70 bg-surface/25 p-5 space-y-5">
                        <div>
                            <div className="text-sm font-bold text-text-primary">
                                {language === 'zh' ? 'GitHub Token' : 'GitHub Token'}
                            </div>
                            <div className="text-xs text-text-muted mt-1 opacity-70">
                                {t('systemSettings.usedForGithubReleases', language)}
                            </div>
                        </div>

                        <input
                            type="password"
                            value={githubToken}
                            onChange={(e) => setGithubToken(e.target.value)}
                            placeholder={t('systemSettings.enterGithubPersonalAccess', language)}
                            className="w-full rounded-xl border border-border bg-background/50 px-4 py-3 text-sm text-text-primary outline-none transition-colors focus:border-accent"
                            autoComplete="off"
                            spellCheck={false}
                        />

                        <div className="flex items-start gap-2 text-[10px] font-medium text-blue-500 bg-blue-500/10 px-3 py-2 rounded-lg border border-blue-500/20">
                            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                            <div>
                                {t('systemSettings.theTokenIsStored', language)}
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section>
                <div className="flex items-center gap-2 mb-3 ml-1">
                    <Globe className="w-4 h-4 text-accent" />
                    <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-[0.14em]">
                        {t('systemSettings.networkProxy', language)}
                    </h4>
                </div>
                <div className="space-y-4">
                    <div className="rounded-xl border border-border/70 bg-surface/25 p-5 space-y-5">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm font-bold text-text-primary">
                                    {t('systemSettings.enableProxy', language)}
                                </div>
                                <div className="text-xs text-text-muted mt-1 opacity-70">
                                    {t('systemSettings.enableGlobalNetworkProxy', language)}
                                </div>
                            </div>
                            <Switch
                                checked={proxySettings.enabled}
                                onChange={(e) => handleToggleProxy(e.target.checked)}
                            />
                        </div>

                        {proxySettings.enabled && (
                            <div className="space-y-5 border-t border-border/40 pt-5 animate-fade-in">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-text-secondary">
                                        {t('systemSettings.proxyServerRules', language)}
                                    </label>
                                    <input
                                        type="text"
                                        value={proxySettings.rules}
                                        onChange={(e) => handleProxyRulesChange(e.target.value)}
                                        placeholder={t('systemSettings.eGHttp127', language)}
                                        className="w-full rounded-xl border border-border bg-background/50 px-4 py-3 text-sm text-text-primary outline-none transition-colors focus:border-accent"
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                    <div className="text-[10px] text-text-muted opacity-75">
                                        {t('systemSettings.specifyProxyServerUrl', language)}
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-text-secondary">
                                        {t('systemSettings.bypassProxyRules', language)}
                                    </label>
                                    <input
                                        type="text"
                                        value={proxySettings.bypassRules}
                                        onChange={(e) => handleProxyBypassChange(e.target.value)}
                                        placeholder={t('systemSettings.eGLocalhost127', language)}
                                        className="w-full rounded-xl border border-border bg-background/50 px-4 py-3 text-sm text-text-primary outline-none transition-colors focus:border-accent"
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                    <div className="text-[10px] text-text-muted opacity-75">
                                        {t('systemSettings.commaSeparatedListOf', language)}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </section>

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
                                <div className="text-sm font-bold text-text-primary">{t('systemSettings.configStoragePath', language)}</div>
                                <div className="text-xs text-text-muted mt-1 opacity-70">
                                    {t('systemSettings.storageLocationForAll', language)}
                                </div>
                            </div>
                            <Button variant="secondary" size="sm" className="rounded-xl px-4" onClick={async () => {
                                const newPath = await api.file.selectFolder()
                                if (newPath) {
                                    const result = await api.settings.setConfigPathDetailed(newPath)
                                    if (result.success) {
                                        toast.success(t('systemSettings.pathUpdatedRestartRequired', language))
                                    } else {
                                        toast.error(
                                            t('systemSettings.failedToUpdatePath', language),
                                            result.error.message,
                                        )
                                    }
                                }
                            }}>
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
                            <div className="text-xs text-text-muted mt-1 opacity-70">{t('systemSettings.clearAppCachesIndex', language)}</div>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="secondary" size="sm" onClick={handleClearCache} disabled={isClearing} className="rounded-xl px-6">
                                {isClearing ? (t('systemSettings.clearing', language)) : (t('common.clear', language))}
                            </Button>
                            <Button variant="danger" size="sm" onClick={handleDeepClearCache} disabled={isClearing} className="rounded-xl px-6">
                                {t('systemSettings.deepClean', language)}
                            </Button>
                        </div>
                    </div>

                    <div className="flex items-center justify-between rounded-xl border border-red-500/20 bg-red-500/[0.07] p-5">
                        <div>
                            <div className="text-sm font-bold text-red-400">{t('systemSettings.resetAllSettings', language)}</div>
                            <div className="text-xs text-red-400/70 mt-1">{t('systemSettings.restoreFactorySettingsIrreversible', language)}</div>
                        </div>
                        <Button variant="danger" size="sm" onClick={handleReset} className="rounded-xl px-6">
                            {t('common.reset2', language)}
                        </Button>
                    </div>
                </div>
            </section>

            {/* 日志管理 */}
            <section>
                <div className="flex items-center gap-2 mb-3 ml-1">
                    <FileText className="w-4 h-4 text-accent" />
                    <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-[0.14em]">
                        {t('systemSettings.logManagement', language)}
                    </h4>
                </div>
                <div className="space-y-4">
                    <div className="rounded-xl border border-border/70 bg-surface/25 p-5 space-y-5">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm font-bold text-text-primary">
                                    {t('systemSettings.enableFileLogging', language)}
                                </div>
                                <div className="text-xs text-text-muted mt-1 opacity-70">
                                    {t('systemSettings.saveApplicationLogsTo', language)}
                                </div>
                            </div>
                            <Switch
                                checked={enableFileLogging}
                                onChange={(e) => handleToggleFileLogging(e.target.checked)}
                            />
                        </div>

                        {enableFileLogging && (
                            <>
                                <div>
                                    <div className="text-sm font-bold text-text-primary mb-3">
                                        {t('systemSettings.logFileLocation', language)}
                                    </div>
                                    {logPath && (
                                        <div className="flex items-center gap-3 p-4 bg-background/50 rounded-xl border border-border shadow-inner">
                                            <div className="p-1.5 bg-white/5 rounded-lg">
                                                <FileText className="w-4 h-4 text-text-muted" />
                                            </div>
                                            <div className="text-xs text-text-secondary font-mono break-all opacity-90 flex-1">
                                                {logPath}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="flex gap-3">
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={handleOpenLogFile}
                                        disabled={!logPath}
                                        className="rounded-xl px-4 flex-1"
                                    >
                                        <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                                        {t('revealInExplorer', language)}
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={handleExportLogs}
                                        className="rounded-xl px-4 flex-1"
                                    >
                                        <Download className="w-3.5 h-3.5 mr-1.5" />
                                        {t('systemSettings.exportLogs', language)}
                                    </Button>
                                </div>

                                <div className="flex items-start gap-2 text-[10px] font-medium text-blue-500 bg-blue-500/10 px-3 py-2 rounded-lg border border-blue-500/20">
                                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                                    <div>
                                        {t('systemSettings.logFilesRotateAutomatically', language)}
                                    </div>
                                </div>
                            </>
                        )}

                        {!enableFileLogging && (
                            <div className="flex items-start gap-2 text-[10px] font-medium text-text-muted bg-white/5 px-3 py-2 rounded-lg border border-border">
                                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                                <div>
                                    {t('systemSettings.fileLoggingIsDisabled', language)}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </section>

            {/* 配置导出/导入 */}
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
                                <div className="text-sm font-bold text-text-primary">{t('systemSettings.exportSettings', language)}</div>
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
                            <div className="text-xs text-text-muted">
                                {t('systemSettings.includeApiKeysNot', language)}
                            </div>
                            <Switch
                                checked={includeApiKeys}
                                onChange={(e) => setIncludeApiKeys(e.target.checked)}
                            />
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
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".json"
                            onChange={handleFileChange}
                            className="hidden"
                        />
                    </div>
                </div>
            </section>

            {/* 版本与更新日志 */}
            <section>
                <div className="flex items-center gap-2 mb-3 ml-1">
                    <BookOpen className="w-4 h-4 text-accent" />
                    <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-[0.14em]">
                        {t('systemSettings.versionHistory', language)}
                    </h4>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border/70 bg-surface/25 p-5">
                    <div>
                        <div className="text-sm font-bold text-text-primary">
                            {t('systemSettings.releaseNotesChangelog', language)}
                        </div>
                        <div className="text-xs text-text-muted mt-1 opacity-70">
                            {t('systemSettings.exploreCompleteReleaseHistory', language)}
                        </div>
                    </div>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => getStore().setShowChangelog(true)}
                        className="rounded-xl px-4 !bg-accent/15 !border-accent/30 !text-accent hover:!bg-accent/25"
                    >
                        <BookOpen className="w-3.5 h-3.5 mr-1.5" />
                        {t('common.viewChangelog', language)}
                    </Button>
                </div>
            </section>
        </div>
    )
}
