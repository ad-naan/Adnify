import { lazy, Suspense, useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Cpu, Settings2, Code, Keyboard, Database, Shield, Monitor, Globe, Plug, Braces, Brain, FileCode, Zap, Check, Search, X } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { PROVIDERS } from '@/shared/config/providers'
import stableStringify from 'fast-json-stable-stringify'
import { getEditorConfig } from '@renderer/settings'
import { captureActiveProviderConfig } from '@renderer/settings/providerConfigPersistence'
import { t, type Language } from '@renderer/i18n'
import { toast } from '@components/common/ToastProvider'
import { globalConfirm } from '@components/common/ConfirmDialog'
import { Button, Modal, Select } from '@components/ui'
import { SettingsTab, EditorSettingsState, LANGUAGES } from './types'
import { SETTINGS_SEARCH_INDEX, type SettingsSearchEntry } from './settingsSearchIndex'

const ProviderSettings = lazy(() =>
    import('./tabs/ProviderSettings').then(module => ({ default: module.ProviderSettings })),
)
const EditorSettings = lazy(() =>
    import('./tabs/EditorSettings').then(module => ({ default: module.EditorSettings })),
)
const SnippetSettings = lazy(() =>
    import('./tabs/SnippetSettings').then(module => ({ default: module.SnippetSettings })),
)
const AgentSettings = lazy(() =>
    import('./tabs/AgentSettings').then(module => ({ default: module.AgentSettings })),
)
const RulesMemorySettings = lazy(() =>
    import('./tabs/RulesMemorySettings').then(module => ({ default: module.RulesMemorySettings })),
)
const SkillSettings = lazy(() =>
    import('./tabs/SkillSettings').then(module => ({ default: module.SkillSettings })),
)
const McpSettings = lazy(() =>
    import('./tabs/McpSettings'),
)
const LspSettings = lazy(() =>
    import('./tabs/LspSettings').then(module => ({ default: module.LspSettings })),
)
const KeybindingPanel = lazy(() =>
    import('@components/panels/KeybindingPanel'),
)
const IndexSettings = lazy(() =>
    import('./tabs/IndexSettings').then(module => ({ default: module.IndexSettings })),
)
const SecuritySettings = lazy(() =>
    import('./tabs/SecuritySettings').then(module => ({ default: module.SecuritySettings })),
)
const SystemSettings = lazy(() =>
    import('./tabs/SystemSettings').then(module => ({ default: module.SystemSettings })),
)

function serializeComparable(value: unknown): string {
    return stableStringify(value) ?? ''
}

function toEditorSettingsState(config: ReturnType<typeof getEditorConfig>): EditorSettingsState {
    return {
        fontSize: config.fontSize,
        chatFontSize: config.chatFontSize ?? config.fontSize,
        tabSize: config.tabSize,
        wordWrap: config.wordWrap,
        lineNumbers: config.lineNumbers,
        minimap: config.minimap,
        bracketPairColorization: config.bracketPairColorization,
        formatOnSave: config.formatOnSave,
        autoSave: config.autoSave,
        autoSaveDelay: config.autoSaveDelay,
        theme: 'adnify-dark',
        completionEnabled: config.ai.completionEnabled,
        completionDebounceMs: config.performance.completionDebounceMs,
        completionMaxTokens: config.ai.completionMaxTokens,
        completionTriggerChars: config.ai.completionTriggerChars,
        terminalScrollback: config.terminal.scrollback,
        terminalMaxOutputLines: config.terminal.maxOutputLines,
        lspTimeoutMs: config.lsp.timeoutMs,
        lspCompletionTimeoutMs: config.lsp.completionTimeoutMs,
        largeFileWarningThresholdMB: config.performance.largeFileWarningThresholdMB,
        largeFileLineCount: config.performance.largeFileLineCount,
        commandTimeoutMs: config.performance.commandTimeoutMs,
        workerTimeoutMs: config.performance.workerTimeoutMs,
        healthCheckTimeoutMs: config.performance.healthCheckTimeoutMs,
        maxProjectFiles: config.performance.maxProjectFiles,
        maxFileTreeDepth: config.performance.maxFileTreeDepth,
        maxSearchResults: config.performance.maxSearchResults,
        saveDebounceMs: config.performance.saveDebounceMs,
        flushIntervalMs: config.performance.flushIntervalMs,
    }
}

function SettingsTabFallback({ language }: { language: Language }) {
    return (
        <div className="min-h-[320px] flex items-center justify-center rounded-2xl border border-border/40 bg-surface/70">
            <div className="flex items-center gap-3 text-sm text-text-muted">
                <div className="w-4 h-4 border-2 border-accent/60 border-t-transparent rounded-full animate-spin" />
                <span>{language === 'zh' ? '正在加载设置项...' : 'Loading settings...'}</span>
            </div>
        </div>
    )
}

export default function SettingsModal() {
    const {
        llmConfig,
        modelRouting,
        language,
        autoApprove,
        providerConfigs,
        promptTemplateId,
        agentConfig,
        aiInstructions,
        webSearchConfig,
        mcpConfig,
        githubToken,
        enableFileLogging,
        proxySettings,
        editorConfig,
        securitySettings,
        set,
        setProvider,
        setShowSettings,
        save,
    } = useStore(useShallow(s => ({
        llmConfig: s.llmConfig,
        modelRouting: s.modelRouting,
        language: s.language,
        autoApprove: s.autoApprove,
        providerConfigs: s.providerConfigs,
        promptTemplateId: s.promptTemplateId,
        agentConfig: s.agentConfig,
        aiInstructions: s.aiInstructions,
        webSearchConfig: s.webSearchConfig,
        mcpConfig: s.mcpConfig,
        githubToken: s.githubToken,
        enableFileLogging: s.enableFileLogging,
        proxySettings: s.proxySettings,
        editorConfig: s.editorConfig,
        securitySettings: s.securitySettings,
        set: s.set,
        setProvider: s.setProvider,
        setShowSettings: s.setShowSettings,
        save: s.save,
    })))

    const [activeTab, setActiveTab] = useState<SettingsTab>('provider')
    const [showApiKey, setShowApiKey] = useState(false)
    const [saved, setSaved] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const searchInputRef = useRef<HTMLInputElement>(null)

    const [localConfig, setLocalConfig] = useState(llmConfig)
    const [localModelRouting, setLocalModelRouting] = useState(modelRouting)
    const [localLanguage, setLocalLanguage] = useState(language)
    const [localAutoApprove, setLocalAutoApprove] = useState(autoApprove)
    const [localPromptTemplateId, setLocalPromptTemplateId] = useState(promptTemplateId)
    const [localAgentConfig, setLocalAgentConfig] = useState(agentConfig)
    const [localProviderConfigs, setLocalProviderConfigs] = useState(providerConfigs)
    const [localAiInstructions, setLocalAiInstructions] = useState(aiInstructions)
    const [localWebSearchConfig, setLocalWebSearchConfig] = useState(webSearchConfig)
    const [localMcpConfig, setLocalMcpConfig] = useState(mcpConfig)
    const [localGithubToken, setLocalGithubToken] = useState(githubToken)
    const [localEnableFileLogging, setLocalEnableFileLogging] = useState(enableFileLogging)
    const [localProxySettings, setLocalProxySettings] = useState(proxySettings)
    const [localSecuritySettings, setLocalSecuritySettings] = useState(securitySettings)
    const [editorSettings, setEditorSettings] = useState<EditorSettingsState>(() => toEditorSettingsState(editorConfig))
    const [advancedEditorConfig, setAdvancedEditorConfig] = useState(editorConfig)
    const [isClosing, setIsClosing] = useState(false)

    useEffect(() => {
        setLocalConfig(llmConfig)
        setLocalModelRouting(modelRouting)
        setLocalLanguage(language)
        setLocalAutoApprove(autoApprove)
        setLocalPromptTemplateId(promptTemplateId)
        setLocalAgentConfig(agentConfig)
        setLocalProviderConfigs(providerConfigs)
        setLocalAiInstructions(aiInstructions)
        setLocalWebSearchConfig(webSearchConfig)
        setLocalMcpConfig(mcpConfig)
        setLocalGithubToken(githubToken)
        setLocalEnableFileLogging(enableFileLogging)
        setLocalProxySettings(proxySettings)
        setLocalSecuritySettings(securitySettings)
        setEditorSettings(toEditorSettingsState(editorConfig))
        setAdvancedEditorConfig(editorConfig)
    }, [
        agentConfig,
        aiInstructions,
        autoApprove,
        editorConfig,
        enableFileLogging,
        proxySettings,
        language,
        llmConfig,
        modelRouting,
        mcpConfig,
        githubToken,
        promptTemplateId,
        providerConfigs,
        securitySettings,
        webSearchConfig,
    ])

    const finalEditorConfig = useMemo(() => ({
        ...advancedEditorConfig,
        fontSize: editorSettings.fontSize,
        chatFontSize: editorSettings.chatFontSize,
        tabSize: editorSettings.tabSize,
        wordWrap: editorSettings.wordWrap,
        lineNumbers: editorSettings.lineNumbers,
        minimap: editorSettings.minimap,
        bracketPairColorization: editorSettings.bracketPairColorization,
        formatOnSave: editorSettings.formatOnSave,
        autoSave: editorSettings.autoSave,
        autoSaveDelay: editorSettings.autoSaveDelay,
        ai: {
            ...advancedEditorConfig.ai,
            completionEnabled: editorSettings.completionEnabled,
            completionMaxTokens: editorSettings.completionMaxTokens,
            completionTriggerChars: editorSettings.completionTriggerChars,
        },
        terminal: {
            ...advancedEditorConfig.terminal,
            scrollback: editorSettings.terminalScrollback,
            maxOutputLines: editorSettings.terminalMaxOutputLines,
        },
        lsp: {
            ...advancedEditorConfig.lsp,
            timeoutMs: editorSettings.lspTimeoutMs,
            completionTimeoutMs: editorSettings.lspCompletionTimeoutMs,
        },
        performance: {
            ...advancedEditorConfig.performance,
            completionDebounceMs: editorSettings.completionDebounceMs,
            largeFileWarningThresholdMB: editorSettings.largeFileWarningThresholdMB,
            largeFileLineCount: editorSettings.largeFileLineCount,
            commandTimeoutMs: editorSettings.commandTimeoutMs,
            workerTimeoutMs: editorSettings.workerTimeoutMs,
            healthCheckTimeoutMs: editorSettings.healthCheckTimeoutMs,
            maxProjectFiles: editorSettings.maxProjectFiles,
            maxFileTreeDepth: editorSettings.maxFileTreeDepth,
            maxSearchResults: editorSettings.maxSearchResults,
            saveDebounceMs: editorSettings.saveDebounceMs,
            flushIntervalMs: editorSettings.flushIntervalMs,
        },
    }), [advancedEditorConfig, editorSettings])

    const sourceSnapshots = useMemo(() => ({
        llmConfig: serializeComparable(llmConfig),
        modelRouting: serializeComparable(modelRouting),
        agentConfig: serializeComparable(agentConfig),
        webSearchConfig: serializeComparable(webSearchConfig),
        mcpConfig: serializeComparable(mcpConfig),
        githubToken: serializeComparable(githubToken),
        providerConfigs: serializeComparable(providerConfigs),
        securitySettings: serializeComparable(securitySettings),
        proxySettings: serializeComparable(proxySettings),
        editorConfig: serializeComparable(editorConfig),
    }), [agentConfig, editorConfig, githubToken, llmConfig, mcpConfig, modelRouting, providerConfigs, securitySettings, webSearchConfig, proxySettings])

    const localSnapshots = useMemo(() => ({
        llmConfig: serializeComparable(localConfig),
        modelRouting: serializeComparable(localModelRouting),
        agentConfig: serializeComparable(localAgentConfig),
        webSearchConfig: serializeComparable(localWebSearchConfig),
        mcpConfig: serializeComparable(localMcpConfig),
        githubToken: serializeComparable(localGithubToken),
        providerConfigs: serializeComparable(localProviderConfigs),
        securitySettings: serializeComparable(localSecuritySettings),
        proxySettings: serializeComparable(localProxySettings),
        editorConfig: serializeComparable(finalEditorConfig),
    }), [finalEditorConfig, localAgentConfig, localConfig, localGithubToken, localMcpConfig, localModelRouting, localProviderConfigs, localSecuritySettings, localWebSearchConfig, localProxySettings])

    const isDirty = useMemo(() => {
        return localSnapshots.llmConfig !== sourceSnapshots.llmConfig ||
            localSnapshots.modelRouting !== sourceSnapshots.modelRouting ||
            localLanguage !== language ||
            localAutoApprove !== autoApprove ||
            localPromptTemplateId !== promptTemplateId ||
            localSnapshots.agentConfig !== sourceSnapshots.agentConfig ||
            localAiInstructions !== aiInstructions ||
            localSnapshots.webSearchConfig !== sourceSnapshots.webSearchConfig ||
            localSnapshots.mcpConfig !== sourceSnapshots.mcpConfig ||
            localSnapshots.githubToken !== sourceSnapshots.githubToken ||
            localEnableFileLogging !== enableFileLogging ||
            localSnapshots.proxySettings !== sourceSnapshots.proxySettings ||
            localSnapshots.providerConfigs !== sourceSnapshots.providerConfigs ||
            localSnapshots.securitySettings !== sourceSnapshots.securitySettings ||
            localSnapshots.editorConfig !== sourceSnapshots.editorConfig
    }, [aiInstructions, autoApprove, enableFileLogging, language, localAiInstructions, localAutoApprove, localEnableFileLogging, localLanguage, localPromptTemplateId, localSnapshots, promptTemplateId, sourceSnapshots])

    const handleSave = useCallback(async () => {
        if (!isDirty) {
            return
        }

        const currentProvider = localConfig.provider
        const providerExists = localProviderConfigs[currentProvider] !== undefined || !!PROVIDERS[currentProvider]

        const finalProviderConfigs = providerExists
            ? {
                ...localProviderConfigs,
                [currentProvider]: captureActiveProviderConfig(
                    localProviderConfigs[currentProvider],
                    localConfig,
                ),
            }
            : { ...localProviderConfigs }

        try {
            set('llmConfig', localConfig)
            set('modelRouting', {
                ...localModelRouting,
                primary: {
                    provider: localConfig.provider,
                    model: localConfig.model,
                },
            })
            set('language', localLanguage)
            set('autoApprove', localAutoApprove)
            set('promptTemplateId', localPromptTemplateId)
            set('agentConfig', localAgentConfig)
            set('aiInstructions', localAiInstructions)
            set('webSearchConfig', localWebSearchConfig)
            set('mcpConfig', localMcpConfig)
            set('githubToken', localGithubToken)
            set('enableFileLogging', localEnableFileLogging)
            set('proxySettings', localProxySettings)
            set('securitySettings', localSecuritySettings)
            set('providerConfigs', finalProviderConfigs)
            set('editorConfig', finalEditorConfig)

            await save()

            try {
                window.electronAPI?.setLanguage?.(localLanguage);
            } catch (e) {
                console.error('语言同步失败:', e)
            }


            if (localWebSearchConfig.googleApiKey && localWebSearchConfig.googleCx) {
                window.electronAPI?.httpSetGoogleSearch?.(localWebSearchConfig.googleApiKey, localWebSearchConfig.googleCx)
            }

            window.electronAPI?.mcpSetAutoConnect?.(localMcpConfig.autoConnect ?? true)

            setSaved(true)
            window.setTimeout(() => setSaved(false), 2000)
            toast.success(t('success.settingsSaved', localLanguage as Language))
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error))
        }
    }, [
        finalEditorConfig,
        isDirty,
        localAgentConfig,
        localAiInstructions,
        localAutoApprove,
        localConfig,
        localEnableFileLogging,
        localProxySettings,
        localGithubToken,
        localLanguage,
        localMcpConfig,
        localModelRouting,
        localPromptTemplateId,
        localProviderConfigs,
        localSecuritySettings,
        localWebSearchConfig,
        save,
        set,
    ])

    const requestClose = useCallback(async () => {
        if (isClosing) {
            return
        }

        setIsClosing(true)

        if (isDirty) {
            const confirmed = await globalConfirm({
                title: t('settings', language as Language),
                message: t('unsavedChangesConfirm', language as Language),
                confirmText: t('discard', language as Language),
                cancelText: t('cancel', language as Language),
                variant: 'warning',
            })
            if (!confirmed) {
                setIsClosing(false)
                return
            }
        }

        setShowSettings(false)
        setIsClosing(false)
    }, [isClosing, isDirty, language, setShowSettings])

    const handleClose = useCallback(() => {
        void requestClose()
    }, [requestClose])

    const providers = useMemo(() =>
        Object.entries(PROVIDERS).map(([id, provider]) => ({
            id,
            name: provider.displayName,
            models: [...(provider.models || []), ...(localProviderConfigs[id]?.customModels || [])]
        })),
        [localProviderConfigs])

    const selectedProvider = useMemo(() =>
        providers.find(provider => provider.id === localConfig.provider),
        [localConfig.provider, providers])

    const tabs = useMemo(() => [
        { id: 'provider', label: language === 'zh' ? '模型提供商' : 'Providers', icon: <Cpu className="w-4 h-4" /> },
        { id: 'editor', label: language === 'zh' ? '编辑器' : 'Editor', icon: <Code className="w-4 h-4" /> },
        { id: 'snippets', label: language === 'zh' ? '代码片段' : 'Snippets', icon: <FileCode className="w-4 h-4" /> },
        { id: 'agent', label: language === 'zh' ? '智能体' : 'Agent', icon: <Settings2 className="w-4 h-4" /> },
        { id: 'rules', label: language === 'zh' ? '规则与记忆' : 'Rules & Memory', icon: <Brain className="w-4 h-4" /> },
        { id: 'skills', label: 'Skills', icon: <Zap className="w-4 h-4" /> },
        { id: 'mcp', label: 'MCP', icon: <Plug className="w-4 h-4" /> },
        { id: 'lsp', label: language === 'zh' ? '语言服务' : 'LSP', icon: <Braces className="w-4 h-4" /> },
        { id: 'keybindings', label: language === 'zh' ? '快捷键' : 'Keybindings', icon: <Keyboard className="w-4 h-4" /> },
        { id: 'indexing', label: language === 'zh' ? '代码索引' : 'Indexing', icon: <Database className="w-4 h-4" /> },
        { id: 'security', label: language === 'zh' ? '安全设置' : 'Security', icon: <Shield className="w-4 h-4" /> },
        { id: 'system', label: language === 'zh' ? '系统' : 'System', icon: <Monitor className="w-4 h-4" /> },
    ] as const, [language])

    // 搜索逻辑：按关键词筛选设置项，按 Tab 分组
    const searchResults = useMemo(() => {
        const q = searchQuery.trim().toLowerCase()
        if (!q) return null
        const matched = SETTINGS_SEARCH_INDEX.filter(entry =>
            entry.label.en.toLowerCase().includes(q) ||
            entry.label.zh.includes(q) ||
            entry.keywords.some(kw => kw.toLowerCase().includes(q))
        )
        const grouped = new Map<SettingsTab, SettingsSearchEntry[]>()
        for (const entry of matched) {
            const list = grouped.get(entry.tab) || []
            list.push(entry)
            grouped.set(entry.tab, list)
        }
        return grouped
    }, [searchQuery])

    const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            setSearchQuery('')
            searchInputRef.current?.blur()
        }
    }, [])

    const handleSearchResultClick = useCallback((tab: SettingsTab) => {
        setActiveTab(tab)
        setSearchQuery('')
    }, [])

    const renderActiveTab = () => {
        switch (activeTab) {
            case 'provider':
                return (
                    <ProviderSettings
                        localConfig={localConfig}
                        setLocalConfig={setLocalConfig}
                        localModelRouting={localModelRouting}
                        setLocalModelRouting={setLocalModelRouting}
                        localProviderConfigs={localProviderConfigs}
                        setLocalProviderConfigs={setLocalProviderConfigs}
                        showApiKey={showApiKey}
                        setShowApiKey={setShowApiKey}
                        selectedProvider={selectedProvider}
                        providers={providers}
                        language={language}
                        setProvider={setProvider}
                    />
                )
            case 'editor':
                return (
                    <EditorSettings
                        settings={editorSettings}
                        setSettings={setEditorSettings}
                        advancedConfig={advancedEditorConfig}
                        setAdvancedConfig={setAdvancedEditorConfig}
                        language={language}
                    />
                )
            case 'snippets':
                return <SnippetSettings language={language} />
            case 'agent':
                return (
                    <AgentSettings
                        aiInstructions={localAiInstructions}
                        setAiInstructions={setLocalAiInstructions}
                        promptTemplateId={localPromptTemplateId}
                        setPromptTemplateId={setLocalPromptTemplateId}
                        agentConfig={localAgentConfig}
                        setAgentConfig={setLocalAgentConfig}
                        webSearchConfig={localWebSearchConfig}
                        setWebSearchConfig={setLocalWebSearchConfig}
                        language={language}
                    />
                )
            case 'rules':
                return <RulesMemorySettings language={language} />
            case 'skills':
                return <SkillSettings language={language} />
            case 'mcp':
                return <McpSettings language={language} mcpConfig={localMcpConfig} setMcpConfig={setLocalMcpConfig} />
            case 'lsp':
                return <LspSettings language={language} />
            case 'keybindings':
                return <KeybindingPanel />
            case 'indexing':
                return <IndexSettings language={language} />
            case 'security':
                return (
                    <SecuritySettings
                        language={language}
                        securitySettings={localSecuritySettings}
                        setSecuritySettings={setLocalSecuritySettings}
                        autoApprove={localAutoApprove}
                        setAutoApprove={setLocalAutoApprove}
                    />
                )
            case 'system':
                return (
                    <SystemSettings
                        language={language}
                        enableFileLogging={localEnableFileLogging}
                        setEnableFileLogging={setLocalEnableFileLogging}
                        githubToken={localGithubToken}
                        setGithubToken={setLocalGithubToken}
                        proxySettings={localProxySettings}
                        setProxySettings={setLocalProxySettings}
                    />
                )
            default:
                return null
        }
    }

    return (
        <Modal isOpen={true} onClose={handleClose} title="" size="5xl" noPadding className="overflow-hidden border border-border/50 shadow-2xl shadow-black/20 rounded-3xl">
            <div className="flex h-[75vh] max-h-[800px]">
                <div className="w-64 bg-surface/30 border-r border-border/50 flex flex-col pt-8 pb-6">
                    <div className="px-6 mb-6">
                        <h2 className="text-lg font-semibold text-text-primary tracking-tight flex items-center gap-2.5">
                            <div className="p-1.5 rounded-lg bg-accent/10 border border-accent/20">
                                <Settings2 className="w-5 h-5 text-accent" />
                            </div>
                            {language === 'zh' ? '设置' : 'Settings'}
                        </h2>
                    </div>

                    <nav className="flex-1 p-4 space-y-1 overflow-y-auto no-scrollbar">
                        {/* 搜索输入框 */}
                        <div className="relative mb-3">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={handleSearchKeyDown}
                                placeholder={language === 'zh' ? '搜索设置...' : 'Search settings...'}
                                className="w-full h-8 pl-9 pr-8 text-xs rounded-lg bg-background/50 border border-border/50 text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/10 transition-all"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>

                        {searchResults === null ? (
                            /* 无搜索时：原有 Tab 列表 */
                            <>
                            {tabs.map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200 group ${activeTab === tab.id ? 'bg-accent/10 text-text-primary border border-accent/20' : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary border border-transparent'}`}
                                >
                                    <span className={`transition-colors duration-200 ${activeTab === tab.id ? 'text-accent' : 'text-text-muted group-hover:text-text-primary'}`}>
                                        {tab.icon}
                                    </span>
                                    <span>{tab.label}</span>
                                </button>
                            ))}
                            </>
                        ) : searchResults.size === 0 ? (
                            /* 无匹配结果 */
                            <div className="flex flex-col items-center justify-center py-8 text-center">
                                <Search className="w-8 h-8 text-text-muted/30 mb-3" />
                                <p className="text-xs text-text-muted">
                                    {language === 'zh' ? '未找到匹配的设置项' : 'No matching settings found'}
                                </p>
                            </div>
                        ) : (
                            /* 搜索结果分组展示 */
                            <div className="space-y-3">
                                {Array.from(searchResults).map(([tabId, entries]) => {
                                    const tabMeta = tabs.find(t => t.id === tabId)
                                    return (
                                        <div key={tabId}>
                                            <div className="flex items-center gap-2 px-2 py-1.5 text-[10px] font-bold text-text-muted uppercase tracking-wider">
                                                <span className="text-accent/70">{tabMeta?.icon}</span>
                                                <span>{tabMeta?.label}</span>
                                            </div>
                                            {entries.map(entry => (
                                                <button
                                                    key={entry.id}
                                                    onClick={() => handleSearchResultClick(entry.tab)}
                                                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors duration-150 ${activeTab === entry.tab ? 'text-text-primary bg-accent/5' : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'}`}
                                                >
                                                    <span className="truncate">{language === 'zh' ? entry.label.zh : entry.label.en}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </nav>

                    <div className="mt-auto px-6 pt-6 border-t border-border/50 space-y-3">
                        <div className="flex items-center gap-2 px-1 text-text-muted opacity-80">
                            <Globe className="w-3.5 h-3.5" />
                            <span className="text-xs font-bold uppercase tracking-widest">{language === 'zh' ? '语言' : 'Language'}</span>
                        </div>
                        <Select
                            value={localLanguage}
                            onChange={(value) => setLocalLanguage(value as 'en' | 'zh')}
                            options={LANGUAGES.map(item => ({ value: item.id, label: item.name }))}
                            className="w-full text-xs bg-surface/50 border-border/50 hover:border-accent/50 transition-colors"
                        />
                    </div>
                </div>

                <div className="flex-1 flex flex-col min-w-0 bg-transparent relative">
                    <div className="settings-scroll-region flex-1 overflow-y-auto px-8 py-8 custom-scrollbar pb-28">
                        <div className="mb-6 pb-5 border-b border-border/40">
                            <h3 className="text-2xl font-semibold text-text-primary tracking-tight">
                                {tabs.find(tab => tab.id === activeTab)?.label}
                            </h3>
                            <p className="text-sm text-text-muted mt-1.5 opacity-80">
                                {t('settings.managePreferences', language as Language)}
                            </p>
                        </div>

                        <div className="settings-tab-panel space-y-6">
                            <Suspense fallback={<SettingsTabFallback language={language as Language} />}>
                                {renderActiveTab()}
                            </Suspense>
                        </div>
                    </div>

                    {(isDirty || saved) && (
                        <div className="absolute bottom-6 right-8 left-8 p-4 rounded-xl bg-surface/95 border border-border/60 shadow-lg flex items-center justify-between z-10 transition-all duration-300">
                            <span className="text-xs text-text-muted ml-2 font-medium">
                                {saved && !isDirty
                                    ? t('settings.allChangesSaved', language as Language)
                                    : t('settings.unsavedChanges', language as Language)}
                            </span>
                            <div className="flex items-center gap-3">
                                <Button variant="ghost" onClick={handleClose} className="hover:bg-text-inverted/[0.05] hover:bg-text-primary/[0.05] text-text-secondary rounded-lg">
                                    {t('cancel', language as Language)}
                                </Button>
                                <Button
                                    variant={saved ? 'primary' : 'primary'}
                                    onClick={handleSave}
                                    disabled={!isDirty}
                                    className={`min-w-[140px] shadow-lg transition-all duration-300 rounded-xl ${saved ? '!bg-status-success hover:!bg-status-success/90 !text-white !border-status-success/30' : ''}`}
                                >
                                    {saved ? (
                                        <span className="flex items-center gap-2 justify-center font-bold">
                                            <Check className="w-4 h-4" />
                                            {t('saved', language as Language)}
                                        </span>
                                    ) : (
                                        <span className="font-bold">{t('settings.saveChanges', language as Language)}</span>
                                    )}
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    )
}
