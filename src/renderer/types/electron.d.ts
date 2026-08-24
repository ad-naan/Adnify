/**
 * Electron API 类型定义
 * 
 * 通用类型直接从 @shared/types 导入使用，这里只定义 Electron 专用类型
 */

// 从 @shared/types 重新导出，供其他文件使用
export type {
  FileItem,
  SearchFilesOptions,
  SearchFileResult,
  IndexStatus,
  IndexSearchResult,
  IndexMode,
  SymbolInfo,
  ProjectSummary,
  EmbeddingProvider,
  LspPosition,
  LspRange,
  LspLocation,
  LspDiagnostic,
  LspHover,
  LspCompletionItem,
  LspCompletionList,
  LspTextEdit,
  LspWorkspaceEdit,
  LspSignatureHelp,
  LspDocumentSymbol,
  LspSymbolInformation,
  LspCodeAction,
  LspFormattingOptions,
  LspDocumentHighlight,
  LspFoldingRange,
  LspInlayHint,
  LspPrepareRename,
} from '@shared/types'

import type {
  SessionCatalogRecord,
  SessionPatch,
  SessionStorageStats,
  SessionWorkerResult,
} from '@shared/types/sessionPersistence'

import type { PreviewProbeResult } from '@shared/types/preview'
import type { FormatDocumentRequest, FormatDocumentResult } from '@shared/types/formatter'

// 从 @shared/types/llm 重新导出
export type {
  LLMStreamChunk,
  LLMToolCall,
  LLMResult,
  LLMError,
  LLMConfig,
  LLMSendMessageParams,
} from '@shared/types/llm'

export type {
  DocumentReaderEmbeddedImage,
  ImageAnalysisRequest,
  ImageAnalysisResult,
  ReadRichContentOptions,
  RichContentReadResult,
} from '@shared/types'

// LLM 响应类型
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  cacheReadSource?: 'provider-reported' | 'derived'
  cacheWriteSource?: 'provider-reported' | 'estimated'
}

export interface ResponseMetadata {
  id: string
  modelId: string
  timestamp: Date
  finishReason?: string
}

export interface LLMResponse<T> {
  data: T
  usage?: TokenUsage
  metadata?: ResponseMetadata
}

// 结构化输出类型
export interface CodeAnalysis {
  issues: Array<{
    severity: 'error' | 'warning' | 'info' | 'hint'
    message: string
    line: number
    column: number
    endLine?: number
    endColumn?: number
    code?: string
    source?: string
  }>
  suggestions: Array<{
    title: string
    description: string
    priority: 'high' | 'medium' | 'low'
    changes?: Array<{
      line: number
      oldText: string
      newText: string
    }>
  }>
  summary: string
}

export interface Refactoring {
  refactorings: Array<{
    title: string
    description: string
    confidence: 'high' | 'medium' | 'low'
    changes: Array<{
      type: 'replace' | 'insert' | 'delete'
      startLine: number
      startColumn: number
      endLine: number
      endColumn: number
      newText?: string
    }>
    explanation: string
  }>
}

export interface CodeFix {
  fixes: Array<{
    diagnosticIndex: number
    title: string
    description: string
    changes: Array<{
      startLine: number
      startColumn: number
      endLine: number
      endColumn: number
      newText: string
    }>
    confidence: 'high' | 'medium' | 'low'
  }>
}

export interface TestCase {
  testCases: Array<{
    name: string
    description: string
    code: string
    type: 'unit' | 'integration' | 'edge-case'
  }>
  setup?: string
  teardown?: string
}

// 从 @shared/types/mcp 重新导出
export type {
  McpServerState,
  McpTool,
  McpToolCallRequest,
  McpToolCallResult,
  McpResourceReadRequest,
  McpResourceReadResult,
  McpPromptGetRequest,
  McpPromptGetResult,
  McpServerStatusEvent,
  McpToolsUpdatedEvent,
  McpResourcesUpdatedEvent,
} from '@shared/types/mcp'

// ============================================
// Electron 专用类型
// ============================================

export interface McpToolWithServer extends McpTool {
  serverId: string
}


export interface SecureCommandRequest {
  command: string
  args?: string[]
  cwd?: string
  timeout?: number
}

export interface WorkspaceConfig {
  configPath: string | null
  roots: string[]
  restoreError?: 'missing-workspace'
  missingRoots?: string[]
  workspaceId?: string
}

export interface RemoteShellEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modifyTime?: number
}

export interface RemoteShellServer {
  host: string
  port?: number
  username?: string
  password?: string
  privateKeyPath?: string
  remotePath?: string
}

export interface RemoteShellUploadResult {
  canceled: boolean
  uploaded: string[]
  uploadedCount?: number
  skippedSymlinks?: number
  isDirectory?: boolean
}

export type RemoteShellUploadMode = 'files' | 'directory'

export interface RemoteShellDownloadResult {
  canceled: boolean
  localPath?: string
  isDirectory?: boolean
  downloadedCount?: number
  skippedSymlinks?: number
}

export type RemoteHostTrustStatus = 'known' | 'accepted_new' | 'mismatch_rejected'

export interface RemoteHostTrustDecision {
  host: string
  port: number
  hostTrustStatus: RemoteHostTrustStatus
  hostFingerprintSha256: string
  knownHostFingerprintSha256?: string
}

export interface EmbeddingConfigInput {
  provider?: 'jina' | 'voyage' | 'openai' | 'cohere' | 'huggingface' | 'ollama' | 'custom'
  apiKey?: string
  model?: string
  baseUrl?: string
  dimensions?: number
}

// ============================================
// Updater 类型
// ============================================

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  releaseNotes?: string
  releaseDate?: string
  downloadUrl?: string
  progress?: number
  error?: string
  requiresManualDownload: boolean
  isPortable: boolean
}

// ============================================
// Debug 类型
// ============================================

export interface DebugConfig {
  type: string
  name: string
  request: 'launch' | 'attach'
  program?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  port?: number
  host?: string
  stopOnEntry?: boolean
  console?: 'internalConsole' | 'integratedTerminal' | 'externalTerminal'
  [key: string]: unknown
}

export interface DebugBreakpointInput {
  line: number
  column?: number
  condition?: string
}

export interface DebugBreakpoint {
  id: string
  file: string
  line: number
  column?: number
  condition?: string
  hitCount?: number
  enabled: boolean
}

export interface DebugStackFrame {
  id: number
  name: string
  line: number
  column: number
  file?: string
  source?: {
    name?: string
    path?: string
    sourceReference?: number
  }
}

export interface DebugScope {
  name: string
  variablesReference: number
  expensive: boolean
}

export interface DebugVariable {
  name: string
  value: string
  type: string
  variablesReference: number
  children?: DebugVariable[]
}

export type DebuggerState = 'idle' | 'running' | 'paused' | 'stopped'

export interface DebugSessionState {
  id: string
  config: DebugConfig
  state: DebuggerState
}

export type DebugEvent =
  | { type: 'started' }
  | { type: 'stopped'; reason: string; threadId?: number }
  | { type: 'continued'; threadId?: number }
  | { type: 'exited'; exitCode: number }
  | { type: 'terminated' }
  | { type: 'breakpoint'; breakpoint: DebugBreakpoint; reason: 'new' | 'changed' | 'removed' }
  | { type: 'output'; category: 'console' | 'stdout' | 'stderr'; output: string }
  | { type: 'error'; message: string }

// ============================================
// Electron API 接口
// ============================================

export interface ElectronAPI {
  // App
  appReady: () => void
  getAppVersion: () => Promise<string>
  respondToShutdownRequest: (requestId: string, success: boolean) => Promise<boolean>
  onShutdownRequested: (callback: (event: { requestId: string; reason: 'window-close' | 'app-quit' }) => void) => () => void
  onOpenFiles: (callback: (event: { items: Array<{ path: string; kind: 'file' | 'folder' | 'workspace'; roots?: string[] }>; source: 'startup' | 'second-instance' | 'open-file' }) => void) => () => void

  // Window
  minimize: () => void
  maximize: () => void
  close: () => void
  toggleDevTools: () => void
  newWindow: () => void
  getWindowId: () => Promise<number>
  resizeWindow: (width: number, height: number, minWidth?: number, minHeight?: number) => Promise<void>
  setTheme: (theme: 'light' | 'dark' | 'system', bgColor?: string) => Promise<boolean>
  getZoomFactor: () => Promise<number>
  setZoomFactor: (zoomFactor: number) => Promise<number>
  setLanguage?: (language: Language) => void,
  // File
  openFile: () => Promise<{ path: string; content: string } | null>
  openFolder: () => Promise<string | null>
  selectFolder: () => Promise<string | null>
  openWorkspace: () => Promise<WorkspaceConfig | null>
  addFolderToWorkspace: () => Promise<string | null>
  saveWorkspace: (configPath: string, roots: string[]) => Promise<boolean>
  restoreWorkspace: () => Promise<WorkspaceConfig | null>
  setActiveWorkspace: (roots: string[]) => Promise<boolean | { redirected: true; roots: string[] }>
  getRecentWorkspaces: () => Promise<string[]>
  workspaceExists: (path: string) => Promise<boolean>
  clearRecentWorkspaces: () => Promise<boolean>
  removeFromRecentWorkspaces: (path: string) => Promise<boolean>
  sessionOpen: () => Promise<Extract<SessionWorkerResult, { type: 'opened' }>>
  sessionLoadCatalog: () => Promise<SessionCatalogRecord>
  sessionLoadMessages: (threadId: string) => Promise<unknown[]>
  sessionLoadBranchMessages: (threadId: string) => Promise<Array<{ id: string; messages: unknown[] }>>
  sessionGetStats: () => Promise<SessionStorageStats>
  sessionLoadPlans: () => Promise<unknown[]>
  sessionUpsertPlan: (plan: unknown) => Promise<boolean>
  sessionDeletePlan: (planId: string) => Promise<boolean>
  sessionApplyPatch: (patch: SessionPatch) => Promise<boolean>
  sessionClear: () => Promise<boolean>
  readDir: (path: string) => Promise<FileItem[]>
  getFileTree: (path: string, maxDepth?: number) => Promise<string>
  readFile: (path: string, encoding?: string, options?: { full?: boolean }) => Promise<string | null>
  statFile: (path: string) => Promise<{ size: number; isDirectory: boolean; isFile: boolean; mtimeMs: number } | null>
  readBinaryFile: (path: string) => Promise<string | null>
  readRichContent: (path: string, options?: ReadRichContentOptions) => Promise<RichContentReadResult>
  readImageAnalysis: (request: ImageAnalysisRequest) => Promise<ImageAnalysisResult>
  writeFile: (path: string, content: string, encoding?: string) => Promise<boolean>
  appendFile: (path: string, content: string, encoding?: string) => Promise<boolean>
  ensureDir: (path: string) => Promise<boolean>
  saveFile: (content: string, path?: string, encoding?: string) => Promise<string | null>
  fileExists: (path: string) => Promise<boolean>
  showItemInFolder: (path: string) => Promise<boolean>
  authorizeSettingsEdit: (path: string, initialContent?: string) => Promise<boolean>
  openInBrowser: (path: string) => Promise<boolean>
  mkdir: (path: string) => Promise<boolean>
  deleteFile: (path: string, approval?: import('@shared/security/executionPolicy').AgentApprovalProof) => Promise<boolean>
  copyFile: (sourcePath: string, destinationPath: string) => Promise<boolean>
  renameFile: (oldPath: string, newPath: string) => Promise<boolean>
  searchFiles: (query: string, rootPath: string | string[], options?: SearchFilesOptions) => Promise<SearchFileResult[]>
  searchStream: (query: string, rootPath: string | string[], options: SearchFilesOptions, searchId: string) => Promise<void>
  onSearchResults: (callback: (searchId: string, results: SearchFileResult[]) => void) => () => void
  onSearchDone: (callback: (searchId: string) => void) => () => void
  onFileChanged: (callback: (event: { event: 'create' | 'update' | 'delete'; path: string }) => void) => () => void

  // Settings
  getSetting: (key: string) => Promise<unknown>
  setSetting: (key: string, value: unknown) => Promise<boolean>
  getConfigPath: () => Promise<string>
  setConfigPath: (path: string) => Promise<boolean>
  onSettingsChanged: (callback: (event: { key: string; value: unknown }) => void) => () => void
  resetWhitelist: () => Promise<{ shell: string[]; git: string[] }>
  getUserDataPath: () => Promise<string>
  getRecentLogs: () => Promise<string>
  deepCleanCache: () => Promise<{ success: boolean; error?: string }>
  // LLM
  sendMessage: (params: LLMSendMessageParams) => Promise<void>
  compactContext: (params: LLMSendMessageParams) => Promise<{
    content?: string
    usage?: TokenUsage
    metadata?: ResponseMetadata
    error?: string
    code?: string
  }>
  abortMessage: (requestId?: string) => void
  onLLMStream: (requestId: string, callback: (chunk: LLMStreamChunk) => void) => () => void
  onLLMToolCall: (callback: (toolCall: LLMToolCall) => void) => () => void
  onLLMError: (requestId: string, callback: (error: LLMError) => void) => () => void
  onLLMDone: (requestId: string, callback: (result: LLMResult) => void) => () => void
  // LLM - Structured Output
  analyzeCode: (params: {
    config: LLMConfig
    code: string
    language: string
    filePath: string
  }) => Promise<LLMResponse<CodeAnalysis>>
  analyzeCodeStream: (params: {
    config: LLMConfig
    code: string
    language: string
    filePath: string
  }) => Promise<LLMResponse<CodeAnalysis>>
  suggestRefactoring: (params: {
    config: LLMConfig
    code: string
    language: string
    intent: string
  }) => Promise<LLMResponse<Refactoring>>
  suggestFixes: (params: {
    config: LLMConfig
    code: string
    language: string
    diagnostics: Array<{
      message: string
      line: number
      column: number
      severity: number
    }>
  }) => Promise<LLMResponse<CodeFix>>
  generateTests: (params: {
    config: LLMConfig
    code: string
    language: string
    framework?: string
  }) => Promise<LLMResponse<TestCase>>
  generateObject: (params: {
    config: LLMConfig
    schema: any
    system: string
    prompt: string
  }) => Promise<{ object: any; usage?: any; metadata?: any; error?: string }>
  // LLM - Embeddings
  embedText: (params: {
    text: string
    config: LLMConfig
  }) => Promise<LLMResponse<number[]>>
  embedMany: (params: {
    texts: string[]
    config: LLMConfig
  }) => Promise<LLMResponse<number[][]>>
  findSimilar: (params: {
    query: string
    candidates: string[]
    config: LLMConfig
    topK?: number
  }) => Promise<Array<{ text: string; similarity: number; index: number }>>

  // Terminal
  createTerminal: (options: { id: string; cwd?: string; shell?: string; backend?: 'pty' | 'pipe'; remote?: RemoteShellServer; isAgent?: boolean }) => Promise<{ success: boolean; error?: string }>
  writeTerminal: (id: string, data: string) => Promise<void>
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>
  killTerminal: (id?: string) => void
  getAvailableShells: () => Promise<{ label: string; path: string }[]>
  onTerminalData: (callback: (event: { id: string; data: string; seq: number; occurredAt: number }) => void) => () => void
  onTerminalExit: (callback: (event: { id: string; exitCode: number; signal?: number; seq: number; occurredAt: number; reason: 'process_exit' | 'killed_by_user' | 'remote_close' }) => void) => () => void
  onTerminalError: (callback: (event: { id: string; error: string; seq: number; occurredAt: number; fatal?: boolean; reason: 'process_error' | 'spawn_error' | 'unknown' }) => void) => () => void

  // Remote Shell / SFTP
  remoteShellList: (server: RemoteShellServer, remotePath?: string) => Promise<RemoteShellEntry[]>
  remoteShellReadText: (server: RemoteShellServer, remotePath: string) => Promise<string | null>
  remoteShellWriteText: (server: RemoteShellServer, remotePath: string, content: string) => Promise<boolean>
  remoteShellMkdir: (server: RemoteShellServer, remotePath: string) => Promise<boolean>
  remoteShellRename: (server: RemoteShellServer, oldPath: string, newPath: string) => Promise<boolean>
  remoteShellDelete: (server: RemoteShellServer, remotePath: string) => Promise<boolean>
  remoteShellTestConnection: (server: RemoteShellServer) => Promise<{ success: boolean; error?: string }>
  remoteShellUpload: (server: RemoteShellServer, remoteDirectory: string, mode?: RemoteShellUploadMode) => Promise<RemoteShellUploadResult>
  remoteShellDownload: (server: RemoteShellServer, remotePath: string) => Promise<RemoteShellDownloadResult>
  remoteHostTrustGetStatus: (server: RemoteShellServer) => Promise<{ known: boolean; fingerprintSha256?: string }>
  remoteHostTrustGetLastDecision: (server: RemoteShellServer) => Promise<RemoteHostTrustDecision | null>

  // Shell
  executeBackground: (params: { command: string; cwd?: string; timeout?: number; shell?: string }) => Promise<{
    success: boolean; output: string; exitCode: number; error?: string
  }>
  onShellOutput: (callback: (event: { command: string; type: 'stdout' | 'stderr'; data: string; timestamp: number }) => void) => () => void
  /**
   * Run a command through pipes and get its real stdout/stderr/exit code.
   * Fallback for when terminal shell integration cannot frame a command.
   */
  runPiped: (params: {
    command: string
    cwd?: string
    timeout?: number
    shell?: string
    maxOutputChars?: number
    authorizationId?: string
  }) => Promise<{
    success: boolean
    stdout: string
    stderr: string
    exitCode: number | null
    signal: string | null
    timedOut: boolean
    truncated: boolean
    durationMs: number
    error?: string
  }>
  executeSecureCommand: (request: SecureCommandRequest) => Promise<{
    success: boolean; output?: string; errorOutput?: string; exitCode?: number; error?: string
  }>

  // Git
  gitExecSecure: (args: string[], cwd: string) => Promise<{
    success: boolean; stdout?: string; stderr?: string; exitCode?: number; error?: string
  }>

  // Security
  requestExternalFileAccess: (filePath: string, access?: 'read' | 'write' | 'manage', approval?: import('@shared/security/executionPolicy').AgentApprovalProof) => Promise<{
    allowed: boolean
    reason: 'invalid-path' | 'already-granted' | 'agent-approved' | 'approval-required' | 'approval-invalid'
  }>
  authorizeCommand: (request: { command: string; cwd?: string; approval?: import('@shared/security/executionPolicy').AgentApprovalProof }) => Promise<{
    allowed: boolean
    authorizationId?: string
    reason?: string
    risk?: string
  }>

  // Index
  indexInitialize: (workspacePath: string) => Promise<{ success: boolean; error?: string }>
  indexStart: (workspacePath: string) => Promise<{ success: boolean; error?: string }>
  indexStatus: (workspacePath: string) => Promise<IndexStatus>
  indexHasIndex: (workspacePath: string) => Promise<boolean>
  indexSearch: (workspacePath: string, query: string, topK?: number) => Promise<IndexSearchResult[]>
  indexHybridSearch: (workspacePath: string, query: string, topK?: number) => Promise<IndexSearchResult[]>
  indexSearchSymbols: (workspacePath: string, query: string, topK?: number) => Promise<SymbolInfo[]>
  indexGetProjectSummary: (workspacePath: string) => Promise<ProjectSummary | null>
  indexGetProjectSummaryText: (workspacePath: string) => Promise<string>
  indexSetMode: (workspacePath: string, mode: 'structural' | 'semantic') => Promise<{ success: boolean; error?: string }>
  indexUpdateFile: (workspacePath: string, filePath: string) => Promise<{ success: boolean; error?: string }>
  indexClear: (workspacePath: string) => Promise<{ success: boolean; error?: string }>
  indexUpdateEmbeddingConfig: (workspacePath: string, config: EmbeddingConfigInput) => Promise<{ success: boolean; error?: string }>
  indexTestConnection: (workspacePath: string) => Promise<{ success: boolean; error?: string; latency?: number }>
  indexGetProviders: () => Promise<EmbeddingProvider[]>
  indexParseCallGraph: (filePath: string, content: string) => Promise<any[]>
  onIndexProgress: (callback: (status: IndexStatus) => void) => () => void

  // LSP
  lspStart: (workspacePath: string) => Promise<{ success: boolean }>
  lspStop: () => Promise<{ success: boolean }>
  lspDidOpen: (params: { uri: string; languageId: string; version: number; text: string; workspacePath?: string | null }) => Promise<{ success: boolean; serverName: string | null }>
  lspDidChange: (params: { uri: string; version: number; text: string; workspacePath?: string | null }) => Promise<void>
  lspDidClose: (params: { uri: string; workspacePath?: string | null }) => Promise<void>
  lspDidSave: (params: { uri: string; text?: string; workspacePath?: string | null }) => Promise<void>
  lspDefinition: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspLocation[] | null>
  lspTypeDefinition: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspLocation[] | null>
  lspImplementation: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspLocation[] | null>
  lspReferences: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspLocation[] | null>
  lspHover: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspHover | null>
  lspCompletion: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspCompletionList | null>
  lspCompletionResolve: (item: LspCompletionItem) => Promise<LspCompletionItem>
  lspSignatureHelp: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspSignatureHelp | null>
  lspRename: (params: { uri: string; line: number; character: number; newName: string; workspacePath?: string | null }) => Promise<LspWorkspaceEdit | null>
  lspPrepareRename: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspPrepareRename | null>
  lspDocumentSymbol: (params: { uri: string; workspacePath?: string | null }) => Promise<LspDocumentSymbol[] | null>
  lspWorkspaceSymbol: (params: { query: string; workspacePath?: string | null }) => Promise<LspSymbolInformation[] | null>
  lspCodeAction: (params: { uri: string; range: LspRange; diagnostics?: LspDiagnostic[]; workspacePath?: string | null }) => Promise<LspCodeAction[] | null>
  lspFormatting: (params: { uri: string; options?: LspFormattingOptions; workspacePath?: string | null }) => Promise<LspTextEdit[] | null>
  lspRangeFormatting: (params: { uri: string; range: LspRange; options?: LspFormattingOptions; workspacePath?: string | null }) => Promise<LspTextEdit[] | null>
  formatterFormatDocument: (request: FormatDocumentRequest) => Promise<FormatDocumentResult>
  lspDocumentHighlight: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspDocumentHighlight[] | null>
  lspFoldingRange: (params: { uri: string; workspacePath?: string | null }) => Promise<LspFoldingRange[] | null>
  lspInlayHint: (params: { uri: string; range: LspRange; workspacePath?: string | null }) => Promise<LspInlayHint[] | null>
  getLspDiagnostics: (filePath: string) => Promise<LspDiagnostic[]>
  onLspDiagnostics: (callback: (params: { uri: string; diagnostics: LspDiagnostic[] }) => void) => () => void
  lspPrepareCallHierarchy: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<unknown[] | null>
  lspIncomingCalls: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<unknown[] | null>
  lspOutgoingCalls: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<unknown[] | null>
  lspWaitForDiagnostics: (params: { uri: string }) => Promise<{ success: boolean }>
  lspFindBestRoot: (params: { filePath: string; languageId: string; workspacePath: string }) => Promise<string>
  lspEnsureServerForFile: (params: { filePath: string; languageId: string; workspacePath: string }) => Promise<{ success: boolean; serverName?: string }>
  lspDidChangeWatchedFiles: (params: { changes: Array<{ uri: string; type: number }>; workspacePath?: string | null }) => Promise<void>
  lspGetSupportedLanguages: () => Promise<string[]>
  lspGetServerStatus: () => Promise<Record<string, { installed: boolean; path?: string }>>
  lspGetBinDir: () => Promise<string>
  lspGetDefaultBinDir: () => Promise<string>
  lspSetCustomBinDir: (customPath: string | null) => Promise<{ success: boolean }>
  lspInstallServer: (serverType: string) => Promise<{ success: boolean; path?: string; error?: string }>
  lspInstallBasicServers: () => Promise<{ success: boolean; error?: string }>

  // LSP 语言环境配置
  lspGetLanguageEnv: (workspacePath: string, languageId: string) => Promise<{ runtimePath?: string; env?: Record<string, string>; extraPaths?: string[] } | null>
  lspSetLanguageEnv: (workspacePath: string, languageId: string, runtimePath: string, extraPaths?: string[]) => Promise<{ success: boolean }>
  lspRemoveLanguageEnv: (workspacePath: string, languageId: string) => Promise<{ success: boolean }>
  lspGetAllLanguageEnv: (workspacePath: string) => Promise<Record<string, { runtimePath?: string; env?: Record<string, string>; extraPaths?: string[] }>>
  lspResolveRuntimePath: (workspacePath: string, languageId: string) => Promise<string>

  // HTTP
  httpReadUrl: (url: string, timeout?: number) => Promise<{
    success: boolean; content?: string; title?: string; error?: string; contentType?: string; statusCode?: number
  }>
  httpWebSearch: (query: string, maxResults?: number, timeout?: number) => Promise<{
    success: boolean; results?: Array<{ title: string; url: string; snippet: string }>; error?: string
  }>
  httpSetGoogleSearch: (apiKey: string, cx: string) => Promise<{ success: boolean }>

  // 本地预览
  previewProbe: (url: string, timeout?: number) => Promise<PreviewProbeResult>
  previewOpenExternal: (url: string) => Promise<boolean>

  // Health Check
  healthCheckProvider: (provider: string, apiKey: string, baseUrl?: string, timeout?: number, protocol?: string) => Promise<{
    provider: string
    status: 'healthy' | 'unhealthy' | 'unknown'
    latency?: number
    error?: string
    checkedAt: Date
  }>
  testModel: (config: LLMConfig) => Promise<{
    success: boolean
    content?: string
    latency?: number
    error?: string
  }>
  fetchModels: (provider: string, apiKey: string, baseUrl?: string, protocol?: string) => Promise<{
    success: boolean
    models?: string[]
    error?: string
  }>

  // MCP
  mcpInitialize: (workspaceRoots: string[]) => Promise<{ success: boolean; error?: string }>
  mcpGetServersState: () => Promise<{ success: boolean; servers?: McpServerState[]; error?: string }>
  mcpGetAllTools: () => Promise<{ success: boolean; tools?: McpToolWithServer[]; error?: string }>
  mcpConnectServer: (serverId: string) => Promise<{ success: boolean; error?: string }>
  mcpDisconnectServer: (serverId: string) => Promise<{ success: boolean; error?: string }>
  mcpReconnectServer: (serverId: string) => Promise<{ success: boolean; error?: string }>
  mcpCallTool: (request: McpToolCallRequest) => Promise<McpToolCallResult>
  mcpReadResource: (request: McpResourceReadRequest) => Promise<McpResourceReadResult>
  mcpGetPrompt: (request: McpPromptGetRequest) => Promise<McpPromptGetResult>
  mcpRefreshCapabilities: (serverId: string) => Promise<{ success: boolean; error?: string }>

  // OpenAI OAuth
  openaiAuthLogin: () => Promise<{ success: boolean; accountID?: string; error?: string }>
  openaiAuthLogout: () => Promise<{ success: boolean; error?: string }>
  openaiAuthStatus: () => Promise<{ loggedIn: boolean; accountID?: string; email?: string; planType?: string; expiresAt?: number }>
  openaiAuthToken: () => Promise<{ token: string | null }>
  openaiAuthUsage: (options?: { refresh?: boolean }) => Promise<{
    usage: {
      planType?: string
      activeLimit?: string
      primary?: { usedPercent: number; windowMinutes?: number; resetAt?: number }
      secondary?: { usedPercent: number; windowMinutes?: number; resetAt?: number }
      credits?: { balance?: number; hasCredits: boolean; unlimited: boolean }
      capturedAt: number
    } | null
  }>
  mcpGetConfigPaths: () => Promise<{ success: boolean; paths?: { user: string; workspace: string[] }; error?: string }>
  mcpReloadConfig: () => Promise<{ success: boolean; error?: string }>
  mcpAddServer: (config: {
    type: 'local' | 'remote'
    id: string
    name: string
    command?: string
    args?: string[]
    env?: Record<string, string>
    url?: string
    headers?: Record<string, string>
    oauth?: { clientId?: string; clientSecret?: string; scope?: string } | false
    autoApprove?: string[]
    disabled?: boolean
  }, level?: 'user' | 'workspace') => Promise<{ success: boolean; error?: string }>
  mcpRemoveServer: (serverId: string, level?: 'user' | 'workspace') => Promise<{ success: boolean; error?: string }>
  mcpToggleServer: (serverId: string, disabled: boolean, level?: 'user' | 'workspace') => Promise<{ success: boolean; error?: string }>
  mcpSetAutoConnect: (enabled: boolean) => Promise<{ success: boolean; error?: string }>
  mcpRegistrySearch: (query?: string) => Promise<{ success: boolean; servers?: any[]; error?: string }>
  mcpRegistryGetDetails: (serverName: string) => Promise<{ success: boolean; server?: any; requiredEnvVars?: any[]; localConfig?: any; error?: string }>
  mcpRegistryInstall: (serverName: string, envValues?: Record<string, string>) => Promise<{ success: boolean; config?: any; error?: string }>
  mcpStartOAuth: (serverId: string) => Promise<{ success: boolean; authorizationUrl?: string; error?: string }>
  mcpFinishOAuth: (serverId: string, authorizationCode: string) => Promise<{ success: boolean; error?: string }>
  mcpRefreshOAuthToken: (serverId: string) => Promise<{ success: boolean; error?: string }>
  onMcpServerStatus: (callback: (event: McpServerStatusEvent & { authUrl?: string }) => void) => () => void
  onMcpToolsUpdated: (callback: (event: McpToolsUpdatedEvent) => void) => () => void
  onMcpResourcesUpdated: (callback: (event: McpResourcesUpdatedEvent) => void) => () => void
  onMcpStateChanged: (callback: (servers: McpServerState[]) => void) => () => void

  // Resources
  resourcesReadJson: <T = unknown>(relativePath: string) => Promise<{ success: boolean; data?: T; error?: string }>
  resourcesReadText: (relativePath: string) => Promise<{ success: boolean; data?: string; error?: string }>
  resourcesExists: (relativePath: string) => Promise<boolean>
  resourcesClearCache: (prefix?: string) => Promise<{ success: boolean }>

  // Debug
  debugCreateSession: (config: DebugConfig) => Promise<{ success: boolean; sessionId?: string; error?: string }>
  debugLaunch: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  debugAttach: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  debugStop: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  debugContinue: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  debugStepOver: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  debugStepInto: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  debugStepOut: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  debugPause: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  debugSetBreakpoints: (sessionId: string, file: string, breakpoints: DebugBreakpointInput[]) => Promise<{ success: boolean; breakpoints?: DebugBreakpoint[]; error?: string }>
  debugGetStackTrace: (sessionId: string, threadId: number) => Promise<{ success: boolean; frames?: DebugStackFrame[]; error?: string }>
  debugGetScopes: (sessionId: string, frameId: number) => Promise<{ success: boolean; scopes?: DebugScope[]; error?: string }>
  debugGetVariables: (sessionId: string, variablesReference: number) => Promise<{ success: boolean; variables?: DebugVariable[]; error?: string }>
  debugEvaluate: (sessionId: string, expression: string, frameId?: number) => Promise<{ success: boolean; result?: { result: string; type: string }; error?: string }>
  debugGetSessionState: (sessionId: string) => Promise<DebugSessionState | null>
  debugGetAllSessions: () => Promise<DebugSessionState[]>
  debugGetSupportedTypes: () => Promise<Array<{ type: string; label: string; languages: string[]; configurationSnippets: any[] }>>
  debugGetConfigSnippets: (type: string) => Promise<any[]>
  debugConfigurationDone: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  debugGetThreads: (sessionId: string) => Promise<{ success: boolean; threads?: any[]; error?: string }>
  debugGetCapabilities: (sessionId: string) => Promise<any>
  onDebugEvent: (callback: (event: { sessionId: string; event: DebugEvent }) => void) => () => void

  // Updater
  updaterCheck: () => Promise<UpdateStatus>
  updaterGetStatus: () => Promise<UpdateStatus>
  updaterDownload: () => Promise<UpdateStatus>
  updaterInstall: () => void
  updaterOpenDownloadPage: (url?: string) => void
  onUpdaterStatus: (callback: (status: UpdateStatus) => void) => () => void

  // App Error (from main process)
  onAppError: (callback: (error: { title: string; message: string; variant?: string }) => void) => () => void

  // Skills
  skillsGetGlobalDir: () => Promise<string>
  skillsGetGlobalDirs?: () => Promise<string[]>

  // Command
  onExecuteCommand: (callback: (commandId: string) => void) => () => void

  // Clipboard
  clipboardReadText: () => Promise<string>
  clipboardWriteText: (text: string) => Promise<boolean>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export { }
