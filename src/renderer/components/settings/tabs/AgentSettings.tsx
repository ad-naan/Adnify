/**
 * Agent 设置组件
 * 完整的 Agent 高级配置面板
 */

import { useState, type ReactNode } from 'react'
import { getPromptTemplates } from '@renderer/agent/prompts/promptTemplates'
import { DEFAULT_AGENT_CONFIG } from '@shared/config/agentConfig'
import { Button, Input, Select, Switch } from '@components/ui'
import { AgentSettingsProps } from '../types'
import { PromptPreviewModal } from './PromptPreviewModal'
import { Bot, FileText, Zap, BrainCircuit, Terminal, Search, Eye, EyeOff, RefreshCw, Pencil, X } from 'lucide-react'
import { ProgressiveReveal } from '../ProgressiveReveal'
import { t as translate, asLanguage } from '@renderer/i18n'

export function AgentSettings({
    aiInstructions, setAiInstructions,
    promptTemplateId, setPromptTemplateId, agentConfig, setAgentConfig,
    webSearchConfig, setWebSearchConfig, language
}: AgentSettingsProps) {
    const templates = getPromptTemplates()
    const [showPreview, setShowPreview] = useState(false)
    const [selectedTemplateForPreview, setSelectedTemplateForPreview] = useState<string | null>(null)
    const [showGoogleApiKey, setShowGoogleApiKey] = useState(false)
    const [editingIgnoredDirs, setEditingIgnoredDirs] = useState(false)

    // 使用 DEFAULT_AGENT_CONFIG 中的忽略目录作为默认值
    const defaultIgnoredDirs = DEFAULT_AGENT_CONFIG.ignoredDirectories
    const [ignoredDirsInput, setIgnoredDirsInput] = useState(
        (agentConfig.ignoredDirectories || defaultIgnoredDirs).join('\n')
    )

    const handlePreviewTemplate = (templateId: string) => {
        setSelectedTemplateForPreview(templateId)
        setShowPreview(true)
    }

    const handleIgnoredDirsChange = (value: string) => {
        setIgnoredDirsInput(value)
        const dirs = value.split(/[\n,]/).map(d => d.trim()).filter(Boolean)
        setAgentConfig({ ...agentConfig, ignoredDirectories: dirs })
    }

    const resetIgnoredDirs = () => {
        setIgnoredDirsInput(defaultIgnoredDirs.join('\n'))
        setAgentConfig({ ...agentConfig, ignoredDirectories: defaultIgnoredDirs })
    }

    return (
        <div className="space-y-6 animate-fade-in pb-10">
            <div className="flex flex-col gap-5">
                {/* Left Column */}
                <div className="contents">
                    {/* 自动化权限 */}
                    <section className="order-1 space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
                        <div className="flex items-center gap-2 mb-1">
                            <Zap className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-medium text-text-primary">{translate('agentSettings.automationPermissions', asLanguage(language))}</h5>
                        </div>
                        <p className="text-xs leading-5 text-text-muted">{translate('agentSettings.controlsProactiveBehaviorWhile', asLanguage(language))}</p>
                        <div className="divide-y divide-border/40">
                            <SettingToggle
                                label={translate('agentSettings.checkAndAttemptFixes', asLanguage(language))}
                                description={translate('agentSettings.whenAToolOr', asLanguage(language))}
                                checked={agentConfig.enableAutoFix}
                                onChange={(checked) => setAgentConfig({ ...agentConfig, enableAutoFix: checked })}
                            />
                            <SettingToggle
                                label={translate('agentSettings.expandExecutionDetailsBy', asLanguage(language))}
                                description={translate('agentSettings.expandsReasoningToolCalls', asLanguage(language))}
                                checked={agentConfig.expandAgentBlocksByDefault ?? false}
                                onChange={(checked) => setAgentConfig({ ...agentConfig, expandAgentBlocksByDefault: checked })}
                            />
                            <SettingToggle
                                label={translate('common.recordToolCallLogs', asLanguage(language))}
                                description={translate('agentSettings.keepsToolRequestsResponses', asLanguage(language))}
                                checked={agentConfig.enableToolCallLogging ?? false}
                                onChange={(checked) => setAgentConfig({ ...agentConfig, enableToolCallLogging: checked })}
                            />
                        </div>
                    </section>

                    {/* Prompt 模板 */}
                    <section className="order-5 space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
                        <div className="flex items-center gap-2 mb-1">
                            <Bot className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-medium text-text-primary">{translate('agentSettings.promptTemplate', asLanguage(language))}</h5>
                        </div>
                        <p className="text-xs leading-5 text-text-muted">{translate('agentSettings.chooseTheAgentS', asLanguage(language))}</p>
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{translate('agentSettings.selectTemplate', asLanguage(language))}</label>
                                <Select
                                    value={promptTemplateId}
                                    onChange={(value) => setPromptTemplateId(value)}
                                    options={templates.map(t => ({
                                        value: t.id,
                                        label: `${t.name} ${t.isDefault ? '(Default)' : ''}`
                                    }))}
                                    className="w-full bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                />
                            </div>

                            <div className="bg-surface/50 p-3 rounded-lg border border-border space-y-2">
                                <div className="flex items-start gap-2 flex-wrap">
                                    <span className="text-xs font-medium text-text-primary">
                                        {templates.find(t => t.id === promptTemplateId)?.name}
                                    </span>
                                    <span className="text-[10px] text-text-muted px-1.5 py-0.5 bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg rounded border border-border">
                                        P{templates.find(t => t.id === promptTemplateId)?.priority}
                                    </span>
                                    {templates.find(t => t.id === promptTemplateId)?.tags?.map(tag => (
                                        <span key={tag} className="text-[10px] text-accent px-1.5 py-0.5 bg-accent/10 rounded">
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                                <p className="text-xs text-text-secondary line-clamp-2">
                                    {language === 'zh'
                                        ? templates.find(t => t.id === promptTemplateId)?.descriptionZh
                                        : templates.find(t => t.id === promptTemplateId)?.description}
                                </p>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => handlePreviewTemplate(promptTemplateId)}
                                    className="w-full text-xs h-7 mt-2"
                                >
                                    {translate('agentSettings.previewFullPrompt', asLanguage(language))}
                                </Button>
                            </div>
                        </div>
                    </section>

                    {/* 自定义系统指令 */}
                    <section className="order-6 space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
                        <div className="flex items-center gap-2 mb-1">
                            <Terminal className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-medium text-text-primary">{translate('agentSettings.customInstructions', asLanguage(language))}</h5>
                        </div>
                        <p className="text-xs leading-5 text-text-muted">{translate('agentSettings.addsPersistentPreferencesAcross', asLanguage(language))}</p>
                        <textarea
                            value={aiInstructions}
                            onChange={(e) => setAiInstructions(e.target.value)}
                            placeholder={translate('agentSettings.enterGlobalSystemInstructions', asLanguage(language))}
                            className="h-32 w-full resize-none rounded-lg border border-border bg-background/50 p-3 font-mono text-xs text-text-primary outline-none transition-colors placeholder-text-muted/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
                        />
                    </section>

                    {/* 网络搜索配置 */}
                    <section className="order-7 space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
                        <div className="flex items-center gap-2 mb-1">
                            <Search className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-medium text-text-primary">{translate('agentSettings.webSearch', asLanguage(language))}</h5>
                        </div>
                        <p className="text-xs text-text-muted">
                            {translate('agentSettings.configureGoogleProgrammableSearch', asLanguage(language))}
                        </p>
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">Google API Key</label>
                                <div className="relative">
                                    <Input
                                        type={showGoogleApiKey ? 'text' : 'password'}
                                        value={webSearchConfig.googleApiKey || ''}
                                        onChange={(e) => setWebSearchConfig({ ...webSearchConfig, googleApiKey: e.target.value })}
                                        placeholder={translate('agentSettings.enterGoogleApiKey', asLanguage(language))}
                                        className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs pr-10"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowGoogleApiKey(!showGoogleApiKey)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                                    >
                                        {showGoogleApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{translate('agentSettings.searchEngineIdCx', asLanguage(language))}</label>
                                <Input
                                    type="text"
                                    value={webSearchConfig.googleCx || ''}
                                    onChange={(e) => setWebSearchConfig({ ...webSearchConfig, googleCx: e.target.value })}
                                    placeholder={translate('agentSettings.enterSearchEngineId', asLanguage(language))}
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                />
                            </div>
                        </div>
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs">
                            <Search className="w-4 h-4 shrink-0 mt-0.5" />
                            <p>
                                {translate('agentSettings.freeTier100Searches', asLanguage(language))}
                            </p>
                        </div>
                    </section>
                </div>

                {/* Right Column */}
                <div className="contents">
                    {/* 基础配置 */}
                    <section className="order-2 space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
                        <div className="flex items-center gap-2 mb-1">
                            <BrainCircuit className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-medium text-text-primary">{translate('agentSettings.basicConfiguration', asLanguage(language))}</h5>
                        </div>
                        <p className="text-xs leading-5 text-text-muted">{translate('agentSettings.limitsToolIterationsPer', asLanguage(language))}</p>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{translate('agentSettings.maxLoops', asLanguage(language))}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxToolLoops}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxToolLoops: parseInt(e.target.value) || 20 })}
                                    min={5}
                                    max={100}
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                />
                                <FieldHint>{translate('agentSettings.maximumConsecutiveToolRounds', asLanguage(language))}</FieldHint>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{translate('agentSettings.maxHistory', asLanguage(language))}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxHistoryMessages}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxHistoryMessages: parseInt(e.target.value) || 60 })}
                                    min={10}
                                    max={200}
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                />
                                <FieldHint>{translate('agentSettings.maximumRecentConversationMessages', asLanguage(language))}</FieldHint>
                            </div>
                        </div>
                    </section>

                    {/* 上下文限制 */}
                    <section className="order-3 space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
                        <div className="flex items-center gap-2 mb-1">
                            <FileText className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-medium text-text-primary">{translate('agentSettings.contextLimits', asLanguage(language))}</h5>
                        </div>
                        <p className="text-xs leading-5 text-text-muted">{translate('agentSettings.controlsHowMuchContent', asLanguage(language))}</p>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{translate('agentSettings.toolResultLimit', asLanguage(language))}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxToolResultChars}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxToolResultChars: parseInt(e.target.value) || 10000 })}
                                    step={5000}
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                />
                                <FieldHint>{translate('agentSettings.maximumCharactersRetainedFrom', asLanguage(language))}</FieldHint>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{translate('agentSettings.contextTokenLimit', asLanguage(language))}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxContextTokens ?? 128000}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxContextTokens: parseInt(e.target.value) || 128000 })}
                                    step={10000}
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                />
                                <FieldHint>{translate('agentSettings.totalModelContextToken', asLanguage(language))}</FieldHint>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{translate('agentSettings.fileContentLimit', asLanguage(language))}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxFileContentChars ?? 15000}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxFileContentChars: parseInt(e.target.value) || 15000 })}
                                    step={5000}
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                />
                                <FieldHint>{translate('agentSettings.maximumCharactersAutomaticallyIncluded', asLanguage(language))}</FieldHint>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{translate('agentSettings.maxFiles', asLanguage(language))}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxContextFiles ?? 6}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxContextFiles: parseInt(e.target.value) || 6 })}
                                    min={1}
                                    max={20}
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                />
                                <FieldHint>{translate('agentSettings.maximumFilesIncludedDuring', asLanguage(language))}</FieldHint>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{translate('agentSettings.semanticResults', asLanguage(language))}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxSemanticResults ?? 5}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxSemanticResults: parseInt(e.target.value) || 5 })}
                                    min={1}
                                    max={20}
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                />
                                <FieldHint>{translate('agentSettings.numberOfSemanticSearch', asLanguage(language))}</FieldHint>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{translate('agentSettings.terminalLimit', asLanguage(language))}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxTerminalChars ?? 3000}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxTerminalChars: parseInt(e.target.value) || 3000 })}
                                    step={1000}
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                />
                                <FieldHint>{translate('agentSettings.maximumTerminalOutputCharacters', asLanguage(language))}</FieldHint>
                            </div>
                        </div>
                    </section>

                    <ProgressiveReveal language={language} collapsedHeight={430} expandLabel={translate('agentSettings.showReliabilityAndContext', asLanguage(language))} className="order-4">
                    <section className="space-y-5 rounded-xl border border-border/70 bg-surface/25 p-5">
                        <div>
                            <h5 className="text-sm font-medium text-text-primary">{translate('agentSettings.executionContext', asLanguage(language))}</h5>
                            <p className="mt-1 text-xs leading-5 text-text-muted">{translate('agentSettings.retriesTimeoutsContextCompression', asLanguage(language))}</p>
                        </div>
                            <div className="space-y-4">
                                {/* 重试 & 超时 */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-text-secondary">{translate('agentSettings.maxRetries', asLanguage(language))}</label>
                                        <Input
                                            type="number"
                                            value={agentConfig.maxRetries ?? 3}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, maxRetries: parseInt(e.target.value) || 3 })}
                                            min={0}
                                            max={10}
                                            className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                        />
                                        <FieldHint>{translate('agentSettings.maximumAutomaticRetriesAfter', asLanguage(language))}</FieldHint>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-text-secondary">{translate('agentSettings.retryDelay', asLanguage(language))}</label>
                                        <Input
                                            type="number"
                                            value={agentConfig.retryDelayMs ?? 1000}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, retryDelayMs: parseInt(e.target.value) || 1000 })}
                                            step={500}
                                            className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                        />
                                        <FieldHint>{translate('agentSettings.millisecondsToWaitBetween', asLanguage(language))}</FieldHint>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-text-secondary">{translate('agentSettings.toolTimeout', asLanguage(language))}</label>
                                        <Input
                                            type="number"
                                            value={agentConfig.toolTimeoutMs ?? 60000}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, toolTimeoutMs: parseInt(e.target.value) || 60000 })}
                                            step={5000}
                                            className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                        />
                                        <FieldHint>{translate('agentSettings.maximumWaitForOne', asLanguage(language))}</FieldHint>
                                    </div>
                                </div>

                                {/* 上下文压缩 */}
                                <div className="p-4 bg-background/30 rounded-xl border border-border/50 space-y-4">
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                                        <label className="text-xs font-bold text-text-primary uppercase tracking-wider">{translate('agentSettings.contextCompression', asLanguage(language))}</label>
                                    </div>
                                    <p className="text-[11px] leading-4 text-text-muted">{translate('agentSettings.whenAConversationNears', asLanguage(language))}</p>

                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-medium text-text-muted px-0.5">{translate('agentSettings.keepRecentTurns', asLanguage(language))}</label>
                                            <Input
                                                type="number"
                                                value={agentConfig.keepRecentTurns ?? 5}
                                                onChange={(e) => setAgentConfig({ ...agentConfig, keepRecentTurns: parseInt(e.target.value) || 5 })}
                                                min={2}
                                                max={20}
                                                className="bg-background/40 border-border/60 focus:border-accent/50 h-9 text-xs"
                                            />
                                            <FieldHint>{translate('agentSettings.recentTurnsAlwaysKept', asLanguage(language))}</FieldHint>
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-medium text-text-muted px-0.5">{translate('agentSettings.deepCompression', asLanguage(language))}</label>
                                            <Input
                                                type="number"
                                                value={agentConfig.deepCompressionTurns ?? 2}
                                                onChange={(e) => setAgentConfig({ ...agentConfig, deepCompressionTurns: parseInt(e.target.value) || 2 })}
                                                min={1}
                                                max={5}
                                                className="bg-background/40 border-border/60 focus:border-accent/50 h-9 text-xs"
                                            />
                                            <FieldHint>{translate('agentSettings.additionalTurnsKeptIn', asLanguage(language))}</FieldHint>
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-medium text-text-muted px-0.5">{translate('agentSettings.importantOld', asLanguage(language))}</label>
                                            <Input
                                                type="number"
                                                value={agentConfig.maxImportantOldTurns ?? 3}
                                                onChange={(e) => setAgentConfig({ ...agentConfig, maxImportantOldTurns: parseInt(e.target.value) || 3 })}
                                                min={0}
                                                max={10}
                                                className="bg-background/40 border-border/60 focus:border-accent/50 h-9 text-xs"
                                            />
                                            <FieldHint>{translate('agentSettings.maximumImportantTurnsRetained', asLanguage(language))}</FieldHint>
                                        </div>
                                    </div>

                                    <div className="divide-y divide-border/30 border-t border-border/30 pt-1">
                                        <SettingToggle label={translate('agentSettings.useModelGeneratedSummaries', asLanguage(language))} description={translate('agentSettings.usesTheModelTo', asLanguage(language))} checked={agentConfig.enableLLMSummary ?? true} onChange={(checked) => setAgentConfig({ ...agentConfig, enableLLMSummary: checked })} />
                                        <SettingToggle label={translate('agentSettings.handoffAutomaticallyWhenContext', asLanguage(language))} description={translate('agentSettings.createsAStructuredHandoff', asLanguage(language))} checked={agentConfig.autoHandoff ?? true} onChange={(checked) => setAgentConfig({ ...agentConfig, autoHandoff: checked })} />
                                        <SettingToggle label={translate('agentSettings.retrieveRelevantCodeAutomatically', asLanguage(language))} description={translate('agentSettings.searchesTheCodeIndex', asLanguage(language))} checked={agentConfig.enableAutoContext ?? true} onChange={(checked) => setAgentConfig({ ...agentConfig, enableAutoContext: checked })} />
                                    </div>
                                </div>

                                {/* 循环检测 */}
                                <div className="p-4 bg-background/30 rounded-xl border border-border/50 space-y-4">
                                    <div className="flex items-center justify-between mb-1">
                                        <div className="flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                                            <label className="text-xs font-bold text-text-primary uppercase tracking-wider">{translate('agentSettings.loopDetection', asLanguage(language))}</label>
                                        </div>
                                        <span className="text-[9px] text-text-muted bg-surface/50 px-2 py-0.5 rounded-full border border-border/30">{translate('agentSettings.warning', asLanguage(language))}</span>
                                    </div>

                                    <p className="text-[11px] leading-4 text-text-muted">{translate('agentSettings.detectsRepeatedCommandsOr', asLanguage(language))}</p>
                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-medium text-text-muted px-0.5">{translate('checkpoint.title', asLanguage(language))}</label>
                                            <Input
                                                type="number"
                                                value={agentConfig.loopDetection?.maxHistory ?? 50}
                                                onChange={(e) => setAgentConfig({
                                                    ...agentConfig,
                                                    loopDetection: {
                                                        ...agentConfig.loopDetection,
                                                        maxHistory: parseInt(e.target.value) || 50
                                                    }
                                                })}
                                                min={10}
                                                max={100}
                                                className="bg-background/40 border-border/60 focus:border-accent/50 h-9 text-xs"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-medium text-text-muted px-0.5">{translate('agentSettings.exactRepeats', asLanguage(language))}</label>
                                            <Input
                                                type="number"
                                                value={agentConfig.loopDetection?.maxExactRepeats ?? 5}
                                                onChange={(e) => setAgentConfig({
                                                    ...agentConfig,
                                                    loopDetection: {
                                                        ...agentConfig.loopDetection,
                                                        maxExactRepeats: parseInt(e.target.value) || 5
                                                    }
                                                })}
                                                min={3}
                                                max={20}
                                                className="bg-background/40 border-border/60 focus:border-accent/50 h-9 text-xs"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-medium text-text-muted px-0.5">{translate('agentSettings.fileEdits', asLanguage(language))}</label>
                                            <Input
                                                type="number"
                                                value={agentConfig.loopDetection?.maxSameTargetRepeats ?? 8}
                                                onChange={(e) => setAgentConfig({
                                                    ...agentConfig,
                                                    loopDetection: {
                                                        ...agentConfig.loopDetection,
                                                        maxSameTargetRepeats: parseInt(e.target.value) || 8
                                                    }
                                                })}
                                                min={3}
                                                max={20}
                                                className="bg-background/40 border-border/60 focus:border-accent/50 h-9 text-xs"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* 忽略目录 */}
                                <div className="space-y-3 rounded-xl border border-border/50 bg-background/30 p-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                                                <span className="text-xs font-semibold text-text-primary">{translate('agentSettings.contextExclusions', asLanguage(language))}</span>
                                            </div>
                                            <p className="mt-1.5 text-[11px] leading-4 text-text-muted">{translate('agentSettings.skippedDuringAutomaticContext', asLanguage(language))}</p>
                                        </div>
                                        <div className="ml-4 flex shrink-0 items-center gap-1">
                                            <button type="button" onClick={() => setEditingIgnoredDirs(value => !value)} className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-lg px-2 text-[11px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
                                                {editingIgnoredDirs ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                                                {editingIgnoredDirs ? translate('agentSettings.done', asLanguage(language)) : translate('editor.edit', asLanguage(language))}
                                            </button>
                                            <button type="button" onClick={resetIgnoredDirs} className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-lg px-2 text-[11px] text-text-muted transition-colors hover:bg-surface-hover hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
                                                <RefreshCw className="h-3.5 w-3.5" />
                                                {translate('common.reset', asLanguage(language))}
                                            </button>
                                        </div>
                                    </div>
                                    {editingIgnoredDirs ? (
                                        <div>
                                            <textarea value={ignoredDirsInput} onChange={(e) => handleIgnoredDirsChange(e.target.value)} className="h-40 w-full resize-y rounded-lg border border-border/60 bg-background/50 p-3 font-mono text-xs leading-5 text-text-secondary outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20" placeholder={translate('agentSettings.oneDirectoryPerLine', asLanguage(language))} />
                                            <p className="mt-1.5 text-[10px] text-text-muted">{translate('agentSettings.useOneDirectoryPer', asLanguage(language))}</p>
                                        </div>
                                    ) : (
                                        <div className="flex flex-wrap gap-2">
                                            {(agentConfig.ignoredDirectories || defaultIgnoredDirs).map(directory => (
                                                <code key={directory} className="rounded-md border border-border/60 bg-surface/60 px-2 py-1 text-[11px] text-text-secondary">{directory}</code>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                    </section>
                    </ProgressiveReveal>
                </div>
            </div>

            {showPreview && selectedTemplateForPreview && (
                <PromptPreviewModal
                    templateId={selectedTemplateForPreview}
                    customInstructions={aiInstructions}
                    language={language}
                    onClose={() => setShowPreview(false)}
                />
            )}
        </div>
    )
}

function SettingToggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex items-start justify-between gap-5 py-3 first:pt-1 last:pb-1">
            <div className="min-w-0">
                <div className="text-xs font-medium text-text-primary">{label}</div>
                <p className="mt-1 max-w-2xl text-[11px] leading-5 text-text-muted">{description}</p>
            </div>
            <Switch checked={checked} onChange={(event) => onChange(event.target.checked)} />
        </div>
    )
}

function FieldHint({ children }: { children: ReactNode }) {
    return <p className="text-[10px] leading-4 text-text-muted">{children}</p>
}
