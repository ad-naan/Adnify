/**
 * Shared configuration types.
 * This is the single source of truth for persisted settings-related shapes.
 */

import type { ApiProtocol, OpenAICompatibilityProfile } from './providers'
import type { LLMConfig, LLMProviderOptions } from '@/shared/types/llm'

export type { LLMConfig }
export type { ApiProtocol }

export interface ProviderConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
  timeout?: number
  customModels?: string[]
  headers?: Record<string, string>
  openAICompatibilityProfile?: OpenAICompatibilityProfile
  displayName?: string
  protocol?: ApiProtocol
  createdAt?: number
  updatedAt?: number
}

export interface AutoApproveSettings {
  terminal: boolean
  dangerous: boolean
}

export interface LoopDetectionConfig {
  maxHistory: number
  maxExactRepeats: number
  maxSameTargetRepeats: number
  dynamicThreshold?: boolean
}

export interface AgentConfig {
  maxToolLoops: number
  maxHistoryMessages: number
  maxToolResultChars: number
  maxFileContentChars: number
  maxTotalContextChars: number
  maxContextTokens: number
  maxSingleFileChars: number
  maxContextFiles: number
  maxSemanticResults: number
  maxTerminalChars: number
  maxRetries: number
  retryDelayMs: number
  retryBackoffMultiplier?: number
  toolTimeoutMs: number
  enableAutoFix: boolean
  expandAgentBlocksByDefault: boolean
  keepRecentTurns: number
  deepCompressionTurns: number
  maxImportantOldTurns: number
  enableLLMSummary: boolean
  autoHandoff: boolean
  summaryMaxContextChars?: {
    quick: number
    detailed: number
    handoff: number
  }
  enableAutoContext?: boolean
  pruneMinimumTokens?: number
  pruneProtectTokens?: number
  loopDetection: LoopDetectionConfig
  dynamicConcurrency?: {
    enabled: boolean
    minConcurrency: number
    maxConcurrency: number
    cpuMultiplier: number
  }
  modePostProcessHooks?: Record<string, unknown>
  toolDependencies?: Record<string, unknown>
  ignoredDirectories: string[]
}

export interface TerminalConfig {
  fontSize: number
  fontFamily: string
  lineHeight: number
  cursorBlink: boolean
  scrollback: number
  maxOutputLines: number
}

export interface GitConfig {
  autoRefresh: boolean
}

export interface LspConfig {
  timeoutMs: number
  completionTimeoutMs: number
  crashCooldownMs: number
}

export interface PerformanceConfig {
  maxProjectFiles: number
  maxFileTreeDepth: number
  fileChangeDebounceMs: number
  completionDebounceMs: number
  searchDebounceMs: number
  saveDebounceMs: number
  indexStatusIntervalMs: number
  fileWatchIntervalMs: number
  flushIntervalMs: number
  requestTimeoutMs: number
  commandTimeoutMs: number
  workerTimeoutMs: number
  healthCheckTimeoutMs: number
  terminalBufferSize: number
  maxResultLength: number
  largeFileWarningThresholdMB: number
  largeFileLineCount: number
  veryLargeFileLineCount: number
  maxSearchResults: number
}

export interface AiCompletionConfig {
  completionEnabled: boolean
  completionMaxTokens: number
  completionTemperature: number
  completionTriggerChars: string[]
}

export interface EditorConfig {
  fontSize: number
  chatFontSize: number
  fontFamily: string
  tabSize: number
  wordWrap: 'on' | 'off' | 'wordWrapColumn'
  lineHeight: number
  minimap: boolean
  minimapScale: number
  lineNumbers: 'on' | 'off' | 'relative'
  bracketPairColorization: boolean
  enableInlineDiff: boolean
  formatOnSave: boolean
  autoSave: 'off' | 'afterDelay' | 'onFocusChange'
  autoSaveDelay: number
  terminal: TerminalConfig
  git: GitConfig
  lsp: LspConfig
  performance: PerformanceConfig
  ai: AiCompletionConfig
}

export interface SecuritySettings {
  enablePermissionConfirm: boolean
  strictWorkspaceMode: boolean
  allowedShellCommands: string[]
  allowedGitSubcommands: string[]
  showSecurityWarnings: boolean
}

export interface WebSearchConfig {
  googleApiKey?: string
  googleCx?: string
}

export interface McpConfig {
  autoConnect?: boolean
}

export interface PersistedLLMConfig {
  provider: string
  model: string
  enableThinking?: boolean
  thinkingBudget?: number
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  temperature?: number
  maxTokens?: number
  topP?: number
  topK?: number
  frequencyPenalty?: number
  presencePenalty?: number
  stopSequences?: string[]
  seed?: number
  logitBias?: Record<string, number>
  maxRetries?: number
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'tool'; toolName: string }
  parallelToolCalls?: boolean
  providerOptions?: LLMProviderOptions
}

export interface AppSettings {
  llmConfig: PersistedLLMConfig
  language: string
  autoApprove: AutoApproveSettings
  promptTemplateId?: string
  agentConfig: AgentConfig
  providerConfigs: Record<string, ProviderConfig>
  aiInstructions: string
  onboardingCompleted: boolean
  webSearchConfig?: WebSearchConfig
  mcpConfig?: McpConfig
}
