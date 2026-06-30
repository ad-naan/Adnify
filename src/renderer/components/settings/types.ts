/**
 * Settings 组件共享类型定义
 */

import { Language } from '@renderer/i18n'
import type { LLMConfig, AutoApproveSettings, AgentConfig, WebSearchConfig, ResolvedModelRoutingConfig } from '@shared/config/types'
import type { ProviderModelConfig } from '@shared/config/settings'

export type SettingsTab = 'provider' | 'editor' | 'snippets' | 'agent' | 'rules' | 'skills' | 'mcp' | 'lsp' | 'keybindings' | 'indexing' | 'security' | 'system'

export interface ProviderSettingsProps {
    localConfig: LLMConfig
    setLocalConfig: React.Dispatch<React.SetStateAction<LLMConfig>>
    localModelRouting: ResolvedModelRoutingConfig
    setLocalModelRouting: React.Dispatch<React.SetStateAction<ResolvedModelRoutingConfig>>
    localProviderConfigs: Record<string, ProviderModelConfig>
    setLocalProviderConfigs: React.Dispatch<React.SetStateAction<Record<string, ProviderModelConfig>>>
    showApiKey: boolean
    setShowApiKey: (show: boolean) => void
    selectedProvider: { id: string; name: string; models: string[] } | undefined
    providers: { id: string; name: string; models: string[] }[]
    language: Language
    setProvider: (id: string, config: ProviderModelConfig) => void
}

export interface EditorSettingsState {
    // 编辑器外观
    fontSize: number
    chatFontSize: number
    tabSize: number
    wordWrap: 'on' | 'off' | 'wordWrapColumn'
    lineNumbers: 'on' | 'off' | 'relative'
    minimap: boolean
    bracketPairColorization: boolean
    formatOnSave: boolean
    autoSave: 'off' | 'afterDelay' | 'onFocusChange'
    autoSaveDelay: number
    theme: string

    // AI 补全
    completionEnabled: boolean
    completionDebounceMs: number
    completionMaxTokens: number
    completionTriggerChars: string[]

    // 终端
    terminalScrollback: number
    terminalMaxOutputLines: number

    // LSP
    lspTimeoutMs: number
    lspCompletionTimeoutMs: number

    // 性能
    largeFileWarningThresholdMB: number
    largeFileLineCount: number
    commandTimeoutMs: number
    workerTimeoutMs: number
    healthCheckTimeoutMs: number
    maxProjectFiles: number
    maxFileTreeDepth: number
    maxSearchResults: number
    saveDebounceMs: number
    flushIntervalMs: number
}

export interface EditorSettingsProps {
    settings: EditorSettingsState
    setSettings: (settings: EditorSettingsState) => void
    advancedConfig: import('@renderer/settings').EditorConfig
    setAdvancedConfig: (config: import('@renderer/settings').EditorConfig) => void
    language: Language
}

export interface AgentSettingsProps {
    autoApprove: AutoApproveSettings
    setAutoApprove: (value: AutoApproveSettings) => void
    aiInstructions: string
    setAiInstructions: (value: string) => void
    promptTemplateId: string
    setPromptTemplateId: (value: string) => void
    agentConfig: AgentConfig
    setAgentConfig: React.Dispatch<React.SetStateAction<AgentConfig>>
    webSearchConfig: WebSearchConfig
    setWebSearchConfig: React.Dispatch<React.SetStateAction<WebSearchConfig>>
    language: Language
}

export interface PromptPreviewModalProps {
    templateId: string
    language: Language
    onClose: () => void
}

// ========== 共享样式常量 ==========
// 所有设置 Tab 统一使用这些常量，确保排版一致性

/** 页面外层容器 */
export const SETTINGS_PAGE = "space-y-8 animate-fade-in pb-10"

/** Section 卡片容器 */
export const SETTINGS_SECTION = "p-6 bg-surface/30 backdrop-blur-sm rounded-xl border border-border/50 space-y-5 shadow-sm hover:border-border transition-colors duration-300"

/** Section 标签文字 */
export const SETTINGS_LABEL = "text-xs font-semibold text-text-secondary uppercase tracking-wider ml-1 mb-2 block"

/** 输入框/下拉框统一样式 */
export const SETTINGS_INPUT = "bg-background/50 border-border/50 text-xs rounded-lg focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all"

/** Section 标题行（带图标） */
export const SETTINGS_SECTION_HEADER = "flex items-center gap-2 mb-1"

/** Section 标题文字 */
export const SETTINGS_SECTION_TITLE = "text-sm font-bold text-text-primary"

/** 外层 Group 标题 */
export const SETTINGS_GROUP_TITLE = "text-[11px] font-bold text-text-muted uppercase tracking-[0.2em]"

/** 次级描述文字 */
export const SETTINGS_DESC = "text-xs text-text-muted mt-1 opacity-70"

export const LANGUAGES: { id: Language; name: string }[] = [
    { id: 'en', name: 'English' },
    { id: 'zh', name: '中文' },
]
