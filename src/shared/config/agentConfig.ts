/**
 * Agent 专用配置
 * 
 * 此文件只包含 Agent 特有的复杂配置（缓存策略、工具截断等）
 * 基础默认值从 defaults.ts 导入
 * 
 * 配置优先级：
 * 1. 用户配置 (UI 设置)
 * 2. 项目配置 (.adnify/agent.json)
 * 3. 默认配置 (defaults.ts + 本文件)
 */

import { AGENT_DEFAULTS } from './defaults'

// ============================================
// 缓存配置（Agent 专用，不暴露给用户 UI）
// ============================================

export type EvictionPolicy = 'lru' | 'lfu' | 'fifo'

export interface CacheConfigDef {
  maxSize: number
  ttlMs: number
  maxMemory?: number
  evictionPolicy?: EvictionPolicy
  slidingExpiration?: boolean
  cleanupInterval?: number
}

export interface CacheConfigs {
  lint: CacheConfigDef
  completion: CacheConfigDef
  directory: CacheConfigDef
  fileContent: CacheConfigDef
  searchResult: CacheConfigDef
  llmProvider: CacheConfigDef
  lspDiagnostics: CacheConfigDef
  healthCheck: CacheConfigDef
}

export const CACHE_DEFAULTS: CacheConfigs = {
  lint: { maxSize: 100, ttlMs: 30000, evictionPolicy: 'lru' },
  completion: { maxSize: 100, ttlMs: 60000, evictionPolicy: 'lru', slidingExpiration: true },
  directory: { maxSize: 200, ttlMs: 300000, evictionPolicy: 'lru' },
  fileContent: { maxSize: 500, ttlMs: 300000, maxMemory: 100 * 1024 * 1024, evictionPolicy: 'lru' },
  searchResult: { maxSize: 100, ttlMs: 120000, maxMemory: 10 * 1024 * 1024, evictionPolicy: 'lfu' },
  llmProvider: { maxSize: 10, ttlMs: 1800000, evictionPolicy: 'lfu', cleanupInterval: 300000 },
  lspDiagnostics: { maxSize: 500, ttlMs: 0, evictionPolicy: 'lru', cleanupInterval: 0 },
  healthCheck: { maxSize: 20, ttlMs: 300000, evictionPolicy: 'fifo' },
}


// ============================================
// 模式后处理钩子配置
// ============================================

export type ModePostProcessHook = (context: {
  mode: string
  messages: unknown[]
  hasWriteOps: boolean
  hasSpecificTool: (toolName: string) => boolean
  iteration: number
  maxIterations: number
}) => { shouldContinue: boolean; reminderMessage?: string } | null

export interface ModePostProcessConfig {
  enabled: boolean
  hook: ModePostProcessHook
}

// ============================================
// 工具依赖配置
// ============================================

export interface ToolDependency {
  /** 依赖的工具名称 */
  dependsOn: string[]
  /** 依赖类型：sequential（必须按顺序）或 parallel（可并行但需等待） */
  type: 'sequential' | 'parallel'
}

// ============================================
// Agent 运行时配置类型
// ============================================

export interface AgentRuntimeConfig {
  // 循环控制
  maxToolLoops: number
  maxHistoryMessages: number
  /** Messages retained per thread on disk; see AGENT_DEFAULTS. */
  maxStoredMessagesPerThread: number

  // 上下文限制
  maxToolResultChars: number
  maxFileContentChars: number
  maxTotalContextChars: number
  maxContextTokens: number
  maxContextFiles: number
  maxSemanticResults: number
  maxTerminalChars: number

  // 重试配置
  maxRetries: number
  retryDelayMs: number
  retryBackoffMultiplier: number

  // 工具执行
  toolTimeoutMs: number
  enableAutoFix: boolean
  enableToolCallLogging: boolean

  // 动态并发控制
  dynamicConcurrency: {
    enabled: boolean
    minConcurrency: number
    maxConcurrency: number
    cpuMultiplier: number  // CPU 核心数的倍数
  }

  // 上下文压缩
  keepRecentTurns: number
  deepCompressionTurns: number
  maxImportantOldTurns: number
  enableLLMSummary: boolean
  autoHandoff: boolean

  // 摘要生成配置
  summaryMaxContextChars: {
    quick: number
    detailed: number
    handoff: number
  }

  // Prune 配置
  pruneMinimumTokens: number
  pruneProtectTokens: number

  // 循环检测（支持动态调整）
  loopDetection: {
    maxHistory: number
    maxExactRepeats: number
    maxSameTargetRepeats: number
    dynamicThreshold: boolean  // 是否根据任务复杂度动态调整
  }

  // 目录忽略列表
  ignoredDirectories: string[]

  // 模式后处理钩子
  modePostProcessHooks?: Record<string, ModePostProcessConfig>

  // 工具依赖声明
  toolDependencies?: Record<string, ToolDependency>

  // 子配置（可选覆盖）
  cache?: Partial<CacheConfigs>

  // 自动上下文（隐式 RAG）
  enableAutoContext?: boolean
}

// 从 defaults.ts 构建完整的 Agent 配置
export const DEFAULT_AGENT_CONFIG: AgentRuntimeConfig = {
  ...AGENT_DEFAULTS,
  loopDetection: {
    ...AGENT_DEFAULTS.loopDetection,
    dynamicThreshold: true,
  },
  summaryMaxContextChars: { ...AGENT_DEFAULTS.summaryMaxContextChars },
  ignoredDirectories: [...AGENT_DEFAULTS.ignoredDirectories],
  dynamicConcurrency: {
    enabled: true,
    minConcurrency: 4,
    maxConcurrency: 16,
    cpuMultiplier: 2,
  },
  toolDependencies: {
    edit_file: {
      dependsOn: ['read_file'],
      type: 'sequential',
    },
  },
  // Auto-Context Configuration
  enableAutoContext: true,
}

// ============================================
// 配置获取辅助函数
// ============================================

export function getCacheConfig(type: keyof CacheConfigs, override?: Partial<CacheConfigDef>): CacheConfigDef {
  const base = CACHE_DEFAULTS[type]
  return override ? { ...base, ...override } : base
}
