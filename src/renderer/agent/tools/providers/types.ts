/**
 * 工具提供者类型定义
 * 定义统一的工具提供者接口
 */

import type {
  ToolDefinition,
  ToolExecutionResult,
  ToolExecutionContext,
  ToolApprovalType,
} from '@/shared/types'

/**
 * 工具提供者接口
 * 所有工具来源（内置、MCP、插件等）都实现此接口
 */
export interface ToolProvider {
  /** 提供者唯一标识 */
  readonly id: string
  
  /** 提供者名称 */
  readonly name: string
  
  /** 检查是否拥有指定工具 */
  hasTool(toolName: string): boolean
  
  /** 获取所有工具定义 */
  getToolDefinitions(): ToolDefinition[]
  
  /** 获取工具审批类型 */
  getApprovalType(toolName: string): ToolApprovalType

  /** Dynamic sources may supply the same metadata as built-in tools. */
  getMetadata?(toolName: string): import('@shared/config/tools').ToolConfig | undefined
  
  /** 验证工具参数 */
  validateArgs(toolName: string, args: unknown): { valid: boolean; error?: string }
  
  /** 执行工具 */
  execute(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult>
}

/**
 * 工具元信息
 */
export interface ToolMeta {
  /** 工具名称 */
  name: string
  /** 来源提供者 ID */
  providerId: string
  /** 来源提供者名称 */
  providerName: string
  /** 工具定义 */
  definition: ToolDefinition
  /** 审批类型 */
  approvalType: ToolApprovalType
}
