/**
 * Agent 核心模块导出
 */

export { Agent } from './Agent'
export { EventBus, type AgentEvent, type EventType } from './EventBus'
export { createStreamProcessor, type StreamProcessor } from './stream'
export { approvalService } from './approvalService'

export type {
  LLMConfig,
  ExecutionContext,
  ToolExecutionContext,
  LLMCallResult,
  LoopCheckResult,
  CompressionStats,
  AgentToolExecutionResult,
} from './types'
