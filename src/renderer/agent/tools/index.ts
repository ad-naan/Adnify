/**
 * 工具模块
 */

// =================== 类型 ===================
export type {
  ToolDefinition,
  ToolExecutionResult,
  ToolExecutionContext,
  ToolExecutor,
  ValidationResult,
  ToolStatus,
  ToolResultType,
  ToolCall,
  ToolApprovalType,
} from '@/shared/types'

// =================== 工具配置 ===================
export type { ToolCategory, ToolConfig } from '@/shared/config/tools'
export {
  TOOL_CONFIGS,
  TOOL_DEFINITIONS,
  TOOL_SCHEMAS,
  TOOL_DISPLAY_NAMES,
  getToolApprovalType,
  getToolDisplayName,
  getReadOnlyTools,
  getWriteTools,
  getParallelTools,
  isParallelTool,
  isWriteTool,
} from '@/shared/config/tools'

// =================== 工具分组 ===================
export type { ToolLoadingContext } from '@/shared/config/toolGroups'
export { getToolsForContext, isToolAvailable } from '@/shared/config/toolGroups'

// =================== 工具注册表 ===================
export { toolRegistry } from './registry'

// =================== 工具执行器 ===================
export { toolExecutors, initializeTools } from './executors'

// =================== 工具提供者 ===================
export type { ToolProvider, ToolMeta } from './providers'
export {
  toolManager,
  builtinToolProvider,
  mcpToolProvider,
  assetToolProvider,
  McpToolProvider,
  initializeToolProviders,
  setToolLoadingContext,
} from './providers'
