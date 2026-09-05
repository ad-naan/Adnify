/**
 * 安全的 IPC handlers 统一导出
 * 所有高危操作都已经过安全重构
 */

import { logger } from '@shared/utils/Logger'
import { BrowserWindow } from 'electron'
import Store from 'electron-store'

import { registerWindowHandlers } from './window' // 窗口控制
import { registerSettingsHandlers } from './settings' // 设置
import { registerSearchHandlers } from './search' // 搜索
import { registerLLMHandlers, cleanupLLMService, cleanupAllLLMServices } from './llm' // LLM
import { registerIndexingHandlers } from './indexing' // 索引
import { registerLspHandlers } from './lsp' // LSP
import { registerHttpHandlers } from './http' // HTTP
import { registerPreviewHandlers } from './preview' // 本地预览探活
import { registerMcpHandlers, cleanupMcpHandlers } from './mcp' // MCP
import { registerResourcesHandlers } from './resources' // 资源
import { registerDebugHandlers } from './debug' // 调试
import { registerHealthCheckHandlers } from './healthCheck' // 健康检查
import { registerRemoteShellHandlers } from './remoteShell' // 远程 Shell / SFTP
import { registerSkillsHandlers } from './skills' // Skills
import { registerProviderCredentialHandlers } from './providerCredentials'
import { registerSessionStorageHandlers } from './sessionStorage'
import { registerFormatterHandlers } from './formatter'
import { registerSystemPrivilegeHandlers } from './systemPrivilege'
import { registerAssetHandlers, cleanupAssetHandlers } from './assets'
import { registerDiagnosticsHandlers } from './diagnostics'
import { registerBackgroundTaskHandlers, cleanupBackgroundTaskHandlers } from './backgroundTasks'
import { resolveWorkspaceFromEvent } from './workspaceContext'

// 安全模块
import {
  securityManager,
  registerSecureTerminalHandlers,
  registerSecureFileHandlers,
  cleanupSecureFileWatcher,
  cleanupTerminals,
  updateWhitelist,
} from '../security'
// 上下文类型
export interface IPCContext {
  // 获取窗口，如果没有指定窗口 ID，则返回最后一个活跃窗口
  getMainWindow: (windowId?: number) => BrowserWindow | null
  // isEmpty: 是否是空窗口，用于创建新窗口
  createWindow: (isEmpty?: boolean) => BrowserWindow
  /** 根据 key 路由到正确的 store */
  resolveStore: (key: string) => Store
  preferencesStore: Store
  workspaceMetaStore: Store
  bootstrapStore: Store
  // 窗口-工作区管理（用于单项目单窗口模式）
  findWindowByWorkspace?: (roots: string[]) => BrowserWindow | null
  setWindowWorkspace?: (windowId: number, roots: string[]) => void
  getWindowWorkspace?: (windowId: number) => string[] | null
}

/**
 * 注册所有安全的 IPC handlers
 */
export function registerAllHandlers(context: IPCContext) {
  const { getMainWindow, createWindow, resolveStore, preferencesStore, workspaceMetaStore, bootstrapStore } = context

  // 窗口控制
  registerWindowHandlers(createWindow)
  registerSystemPrivilegeHandlers(getMainWindow)
  registerDiagnosticsHandlers(context)
  registerBackgroundTaskHandlers(preferencesStore)

  // 文件操作（安全版）
  registerSecureFileHandlers(getMainWindow, workspaceMetaStore, (event) =>
    resolveWorkspaceFromEvent(event, {
      getWindowWorkspace: context.getWindowWorkspace,
      workspaceMetaStore,
    }),
  {
    findWindowByWorkspace: context.findWindowByWorkspace,
    setWindowWorkspace: context.setWindowWorkspace,
  })

  // 设置（传入 resolveStore 和各 store 引用）
  registerSettingsHandlers(resolveStore, preferencesStore, bootstrapStore, {
    securityManager,
    updateWhitelist
  })

  // 终端（安全版）- 传入窗口工作区获取函数实现多窗口隔离
  registerSecureTerminalHandlers(getMainWindow, (event) =>
    resolveWorkspaceFromEvent(event, {
      getWindowWorkspace: context.getWindowWorkspace,
      workspaceMetaStore,
    }),
  context.getWindowWorkspace)

  // 搜索
  registerSearchHandlers()

  // LLM
  registerLLMHandlers(getMainWindow)

  // 索引 - 传入 workspaceMetaStore 以读取保存的 embedding 配置
  registerIndexingHandlers(getMainWindow, workspaceMetaStore)

  // LSP 语言服务
  registerLspHandlers(preferencesStore)

  // 项目级格式化工具（Prettier、Biome 及各语言原生 formatter）
  registerFormatterHandlers(event =>
    resolveWorkspaceFromEvent(event, {
      getWindowWorkspace: context.getWindowWorkspace,
      workspaceMetaStore,
    }),
  )

  // HTTP 请求（用于 web_search / read_url）
  registerHttpHandlers()

  // 本地预览服务探活
  registerPreviewHandlers(context.getWindowWorkspace)

  // MCP 服务
  registerMcpHandlers(getMainWindow)

  // 静态资源
  registerResourcesHandlers()

  // 调试服务
  registerDebugHandlers()

  // 健康检查
  registerHealthCheckHandlers()

  // 远程 Shell / SFTP
  registerRemoteShellHandlers()

  // Skills
  registerSkillsHandlers()

  registerProviderCredentialHandlers()
  registerAssetHandlers(context)

  registerSessionStorageHandlers({
    getWindowWorkspace: context.getWindowWorkspace,
    workspaceMetaStore,
  })

  logger.ipc.info('[Security] 所有安全IPC处理器已注册')
}

/**
 * 清理所有资源
 */
export function cleanupAllHandlers() {
  cleanupBackgroundTaskHandlers()
  cleanupAssetHandlers()
  logger.ipc.info('[IPC] Cleaning up all handlers...')
  cleanupTerminals()
  cleanupSecureFileWatcher()
  cleanupMcpHandlers()
  cleanupAllLLMServices()
  // DebugService 清理由 performGlobalCleanup 中异步处理（需要 await）
  logger.ipc.info('[IPC] All handlers cleaned up')
}

export { cleanupLLMService }
