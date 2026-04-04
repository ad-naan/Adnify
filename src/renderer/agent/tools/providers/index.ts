/**
 * 工具提供者模块
 */

// 类型
export type { ToolProvider, ToolMeta } from './types'
export type { ToolLoadingContext } from '@/shared/config/toolGroups'

// 工具管理器
export { toolManager } from './ToolManager'

// 内置工具提供者
export { BuiltinToolProvider, builtinToolProvider } from './BuiltinToolProvider'

// MCP 工具提供者
export { McpToolProvider, mcpToolProvider } from './McpToolProvider'

// =================== 初始化 ===================

import { toolManager } from './ToolManager'
import { builtinToolProvider } from './BuiltinToolProvider'
import { mcpToolProvider } from './McpToolProvider'
import type { ToolLoadingContext } from '@/shared/config/toolGroups'

let initialized = false

/**
 * 初始化工具提供者系统
 */
export function initializeToolProviders(): void {
  if (initialized) return
  toolManager.registerProvider(builtinToolProvider, 0)
  toolManager.registerProvider(mcpToolProvider, 10)
  initialized = true
}

/**
 * 设置工具加载上下文
 */
export function setToolLoadingContext(context: ToolLoadingContext): void {
  builtinToolProvider.setContext(context)
  mcpToolProvider.setContext(context)
}
