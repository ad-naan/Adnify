/**
 * Agent 核心类型定义
 */

import type { WorkMode } from '@/renderer/modes/types'
import type { ToolCall, TokenUsage } from '../types'
import type { LLMConfig as SharedLLMConfig, LLMResponseMetadata } from '@/shared/types/llm'
import type { LLMStreamSource } from '@/shared/types/llm'

// ===== LLM 配置（扩展 shared 定义，添加 contextLimit） =====

export interface LLMConfig extends SharedLLMConfig {
  /** 模型上下文限制（用于压缩判断） */
  contextLimit?: number
}

// ===== 执行上下文 =====

export interface ExecutionContext {
  workspacePath: string | null
  chatMode: WorkMode
  planPhase?: 'planning' | 'executing'
  systemPrompt?: string
  abortSignal?: AbortSignal
  /** 绑定的线程 ID（用于后台任务隔离） */
  threadId?: string | null
  requestId?: string
  planTaskId?: string
  checkpointId?: string
  /**
   * 本次循环是否运行在子代理的隐藏线程里。
   * 用于把 task / ask_user / 计划类工具从子代理的工具集里剔掉，见
   * SUB_AGENT_EXCLUDED_TOOLS。
   */
  isSubAgent?: boolean
}

// ===== 工具执行上下文（重新导出 shared 定义） =====

export type { ToolExecutionContext } from '@/shared/types'

// ===== LLM 调用结果 =====

export interface LLMCallResult {
  content?: string
  reasoning?: string
  reasoningSignature?: string
  toolCalls?: ToolCall[]
  sources?: LLMStreamSource[]
  usage?: TokenUsage
  metadata?: LLMResponseMetadata
  error?: string
}

// ===== 循环检测结果 =====

export interface LoopCheckResult {
  isLoop: boolean
  reason?: string
  suggestion?: string
  warning?: string
  details?: {
    category: 'exact_repeat' | 'same_tool_warning' | 'content_cycle' | 'pattern_loop' | 'semantic_navigation' | 'tool_routing'
    toolName?: string
    count?: number
    threshold?: number
    target?: string | null
    pattern?: string
  }
}

// ===== 压缩统计（从 CompressionManager 导出） =====

export type { CompressionStats } from '../domains/context/CompressionManager'
export type { CompressionLevel } from '../domains/context/compressionShared'

// ===== 工具执行结果（Agent 内部使用，包含 toolCall 信息） =====

/**
 * 工具最终落地的状态。
 *
 * 存在的理由：以前下游靠 `content.startsWith('Error:')` 反推成败，
 * 而 `executeSingle` 本来就从 toolManager 拿到了真实的 `result.success`，
 * 只是没往外带。结果是两类错判：
 *   - 工具成功但输出恰好以 "Error:" 开头（编译器日志、grep 命中 "Error: ..."
 *     的那一行、被 truncate 到头部正好是错误行的命令输出）→ 判成失败
 *   - 'Rejected by user' / 'Skipped: dependency not met' 不以 "Error:" 开头
 *     → 判成成功
 * 现在状态由产生它的地方直接声明，下游不再猜。
 */
export type AgentToolStatus = 'success' | 'error' | 'rejected' | 'skipped'

export interface AgentToolExecutionResult {
  toolCall: ToolCall
  result: {
    content: string
    /** 必填：由构造方显式声明，不允许下游从 content 反推 */
    status: AgentToolStatus
    meta?: Record<string, unknown>
    richContent?: import('@/shared/types').ToolRichContent[]
  }
}

// ===== 重新导出 =====

export type { ToolCall, TokenUsage }
