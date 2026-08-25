/**
 * 全局默认配置值 - 单一真相来源 (Single Source of Truth)
 * 
 * 架构说明：
 * - 此文件包含所有可配置参数的默认值
 * - 主进程和渲染进程都可以安全导入
 * - 只包含纯数据，不包含任何副作用或 IO 操作
 * - 其他配置文件应从此处导入默认值，而非重复定义
 */

export { SECURITY_SETTINGS_DEFAULTS } from './securitySettings'

// ============================================
// LLM 配置默认值
// ============================================

export const LLM_DEFAULTS = {
  temperature: 0.7,
  topP: 1,
  maxTokens: 8192,
  timeout: 120000,
  frequencyPenalty: 0,
  presencePenalty: 0,
  defaultProvider: 'openai',
  defaultModel: 'gpt-4o',
  topK: 0,
  seed: undefined,
  // AI SDK 高级参数默认值
  maxRetries: 2,  // AI SDK 默认是 2 次重试
  toolChoice: 'auto' as const,  // 默认自动选择工具
  parallelToolCalls: true,  // OpenAI 默认允许并行工具调用
  headers: undefined,  // 默认无自定义请求头
  logitBias: undefined,  // 默认无 logit bias
  stopSequences: undefined,  // 默认无停止序列
} as const

export const MODEL_ROUTING_DEFAULTS = {
  enabled: false,
  fallbackPolicy: 'primary_with_notice',
  handoffFormat: 'structured_summary_with_raw_block',
} as const

// ============================================
// AI 补全配置默认值
// ============================================

export const AI_COMPLETION_DEFAULTS = {
  enabled: true,
  maxTokens: 256,
  temperature: 0.1,
  triggerChars: ['.', '(', '{', '[', '"', "'", '/', ' '],
} as const

// ============================================
// LSP 配置默认值
// ============================================

export const LSP_DEFAULTS = {
  timeoutMs: 30000,
  completionTimeoutMs: 2000,
  crashCooldownMs: 5000,
} as const

// ============================================
// 终端配置默认值
// ============================================

export const TERMINAL_DEFAULTS = {
  fontSize: 13,
  fontFamily: "'JetBrains Mono', 'JetBrainsMono', 'Fira Code', 'FiraCode-Retina', 'Consolas', 'Monaco', 'Hannotate SC', monospace, -apple-system",
  lineHeight: 1.2,
  cursorBlink: true,
  scrollback: 1000,
  maxOutputLines: 1000,
  nodePackageManager: 'auto',
} as const

// ============================================
// 编辑器配置默认值
// ============================================

export const EDITOR_DEFAULTS = {
  fontSize: 13,
  fontFamily: "'JetBrains Mono', 'JetBrainsMono', 'Fira Code', 'FiraCode-Retina', 'Consolas', 'Monaco', 'Hannotate SC', monospace, -apple-system",
  uiScale: 1,
  layoutDensity: 'comfortable' as const,
  tabSize: 2,
  wordWrap: 'on' as const,
  lineHeight: 1.5,
  minimap: true,
  minimapScale: 1,
  lineNumbers: 'on' as const,
  bracketPairColorization: true,
  enableInlineDiff: true,
  formatOnSave: false,
  autoSave: 'off' as const,
  autoSaveDelay: 1000,
} as const

// ============================================
// Git 配置默认值
// ============================================

export const DEFAULT_GIT_COMMIT_PROMPT = `Based on the following git diff, generate a concise and descriptive commit message. Follow conventional commits format (e.g., feat:, fix:, docs:, refactor:, etc.). Only output the commit message, nothing else.`

export const GIT_DEFAULTS = {
  autoRefresh: true,
  commitPrompt: '',
} as const

// ============================================
// 性能配置默认值
// ============================================

export const PERFORMANCE_DEFAULTS = {
  // 文件扫描
  maxProjectFiles: 500,
  maxFileTreeDepth: 5,

  // 防抖延迟 (ms)
  fileChangeDebounceMs: 300,
  completionDebounceMs: 300,
  searchDebounceMs: 200,
  saveDebounceMs: 2000,

  // 刷新间隔 (ms)
  indexStatusIntervalMs: 10000,
  fileWatchIntervalMs: 5000,
  flushIntervalMs: 5000,

  // 超时 (ms)
  requestTimeoutMs: 120000,
  commandTimeoutMs: 30000,
  workerTimeoutMs: 30000,
  healthCheckTimeoutMs: 10000,

  // 缓冲区大小
  terminalBufferSize: 500,
  maxResultLength: 2000,

  // 文件大小限制
  largeFileWarningThresholdMB: 5,
  largeFileLineCount: 10000,
  veryLargeFileLineCount: 50000,

  // 搜索限制
  maxSearchResults: 1000,
} as const

// ============================================
// Agent 运行时配置默认值
// ============================================

export const AGENT_DEFAULTS = {
  // 循环控制
  maxToolLoops: 20,
  maxHistoryMessages: 60,
  /**
   * Hard cap on messages RETAINED PER THREAD (storage), distinct from
   * `maxHistoryMessages` which bounds what is sent to the model.
   *
   * Only thread COUNT was capped (50), so a single long session grew its
   * `<id>.jsonl` without limit — and that file is rewritten in full on every
   * dirty flush, so cost grew with history length. Set well above
   * `maxHistoryMessages` so scrollback stays useful; trimming only discards
   * messages the model can no longer see anyway.
   */
  maxStoredMessagesPerThread: 1000,

  // 上下文限制
  maxToolResultChars: 10000,
  maxFileContentChars: 15000,
  maxTotalContextChars: 60000,
  maxContextTokens: 128000,
  maxContextFiles: 6,
  maxSemanticResults: 5,
  maxTerminalChars: 3000,

  // 重试配置
  maxRetries: 3,
  retryDelayMs: 1000,
  retryBackoffMultiplier: 1.5,

  // 工具执行
  toolTimeoutMs: 60000,
  enableAutoFix: true,
  expandAgentBlocksByDefault: false,

  // 上下文压缩
  keepRecentTurns: 5,
  deepCompressionTurns: 2,
  maxImportantOldTurns: 3,
  enableLLMSummary: true,
  autoHandoff: true,

  // 摘要生成配置
  summaryMaxContextChars: {
    quick: 8000,      // 快速摘要：8k 字符
    detailed: 12000,  // 详细摘要：12k 字符
    handoff: 16000,   // Handoff 摘要：16k 字符（需要更多上下文）
  },

  // Prune 配置（工具结果清理）
  pruneMinimumTokens: 20000,      // 开始 prune 的最小 token 阈值
  pruneProtectTokens: 40000,      // 保护最近多少 token 的工具调用不被 prune

  // 循环检测
  loopDetection: {
    maxHistory: 50,            // 历史记录保留数量
    maxExactRepeats: 5,        // 相同参数的精确重复阈值
    maxSameTargetRepeats: 8,   // 同一文件的连续编辑阈值
    dynamicThreshold: true,    // 根据任务复杂度动态调整阈值
  },

  // 动态并发控制
  dynamicConcurrency: {
    enabled: true,
    minConcurrency: 4,
    maxConcurrency: 16,
    cpuMultiplier: 2,
  },

  // 目录排除列表
  ignoredDirectories: [
    'node_modules', '.git', '.adnify', 'dist', 'build', '.next',
    '__pycache__', '.venv', 'venv', '.cache', 'coverage',
    '.nyc_output', 'tmp', 'temp', '.idea', '.vscode',
  ],
} as const

// ============================================
// 自动审批默认值
// ============================================

export const AUTO_APPROVE_DEFAULTS = {
  terminalCommandRules: [] as import('./types').TerminalCommandRule[],
} as const

/**
 * Selectable monospace font stacks for the editor and terminal.
 *
 * Each entry keeps generic fallbacks so an unavailable first choice still
 * resolves to something monospaced. `value` is stored verbatim as a CSS
 * font-family list; the settings UI treats anything not listed here as a
 * user-provided custom stack.
 */
export const CODE_FONT_PRESETS = [
  { label: 'JetBrains Mono', value: "'JetBrains Mono', 'JetBrainsMono', Consolas, Monaco, monospace" },
  { label: 'Fira Code', value: "'Fira Code', 'FiraCode-Retina', Consolas, Monaco, monospace" },
  { label: 'Cascadia Code', value: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace" },
  { label: 'Source Code Pro', value: "'Source Code Pro', Consolas, Monaco, monospace" },
  { label: 'IBM Plex Mono', value: "'IBM Plex Mono', Consolas, Monaco, monospace" },
  { label: 'Consolas', value: 'Consolas, Monaco, monospace' },
  { label: 'Menlo / Monaco', value: 'Menlo, Monaco, Consolas, monospace' },
  { label: 'SF Mono', value: "'SF Mono', 'SFMono-Regular', Menlo, Consolas, monospace" },
] as const
