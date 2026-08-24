/**
 * 安全审计和权限管理模块
 * 统一管理所有敏感操作的权限校验和审计日志
 */

import { logger } from '@shared/utils/Logger'
import * as path from 'path'
import { dialog, BrowserWindow } from 'electron'
import { isSensitivePath as sharedIsSensitivePath } from '@shared/constants'
import { pathStartsWith, pathEquals } from '@shared/utils/pathUtils'
import type { SecuritySettings } from '@shared/config/types'

// 敏感操作类型
export enum OperationType {
  // 文件系统
  FILE_READ = 'file:read',
  FILE_WRITE = 'file:write',
  FILE_DELETE = 'file:delete',
  FILE_RENAME = 'file:rename',

  // 终端/命令
  SHELL_EXECUTE = 'shell:execute',
  TERMINAL_INTERACTIVE = 'terminal:interactive',

  // Git
  GIT_EXEC = 'git:exec',

}

interface SecurityModule {
  requestApproval: (operation: OperationType, target: string, reason: string) => Promise<boolean>

  // 工作区设置
  setWorkspacePath: (workspacePath: string | null) => void

  // 安全操作日志（通过 logger 输出，不写文件）
  logOperation: (operation: OperationType, target: string, success: boolean, detail?: any) => void

  // 工作区安全边界
  validateWorkspacePath: (filePath: string, workspace: string | string[]) => boolean
  isSensitivePath: (filePath: string) => boolean

  // 配置更新
  updateConfig: (config: Partial<SecuritySettings>) => void
}

class SecurityManager implements SecurityModule {
  private pendingApprovals = new Map<string, Promise<boolean>>()
  private config: Partial<SecuritySettings> = {}

  /**
   * 设置当前工作区路径（保留接口兼容）
   */
  setWorkspacePath(workspacePath: string | null) {
    logger.security.info('[Security] Workspace path set:', workspacePath)
  }

  /**
   * 更新安全配置
   */
  updateConfig(config: Partial<SecuritySettings>) {
    this.config = { ...this.config, ...config }
    logger.security.info('[Security] Configuration updated:', this.config)
  }

  /**
   * Explicit risk approval. Unlike legacy permission levels, this is always
   * shown for an elevated decision and is never cached as a broad grant.
   */
  async requestApproval(operation: OperationType, target: string, reason: string): Promise<boolean> {
    const key = `${operation}:${target}`
    const pending = this.pendingApprovals.get(key)
    if (pending) return pending

    const approval = (async () => {
      const mainWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const options = {
        type: 'warning' as const,
        buttons: ['仅此次允许', '拒绝'],
        defaultId: 1,
        cancelId: 1,
        title: '安全审批',
        message: '此操作需要明确授权',
        detail: `原因：${reason}\n\n操作：${operation}\n目标：${target}`,
        noLink: true,
      }
      const result = mainWindow
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options)
      const allowed = result.response === 0
      this.logOperation(operation, target, allowed, {
        reason,
        decision: allowed ? 'approved-once' : 'denied',
      })
      return allowed
    })()
    this.pendingApprovals.set(key, approval)
    try {
      return await approval
    } finally {
      this.pendingApprovals.delete(key)
    }
  }

  /**
   * 记录安全操作日志（仅通过 logger 输出，不写文件）
   */
  logOperation(operation: OperationType, target: string, success: boolean, detail?: any): void {
    const status = success ? '✅' : '❌'
    const detailStr = detail ? ` | ${JSON.stringify(detail)}` : ''
    logger.security.info(`[Security] ${status} ${operation} - ${target}${detailStr}`)
  }

  /**
   * 验证工作区边界
   */
  validateWorkspacePath(filePath: string, workspace: string | string[]): boolean {
    // 如果未启用严格工作区模式，允许所有路径（但仍检查敏感路径）
    if (this.config.strictWorkspaceMode === false) {
      const resolvedPath = path.resolve(filePath)
      return !this.isSensitivePath(resolvedPath)
    }
    
    if (!workspace) return false
    const workspaces = Array.isArray(workspace) ? workspace : [workspace]

    try {
      const resolvedPath = path.resolve(filePath)

      // 使用 pathStartsWith 进行路径比较（忽略大小写和分隔符差异）
      const isInside = workspaces.some(ws => {
        if (typeof ws !== 'string') return false
        const resolvedWorkspace = path.resolve(ws)
        return pathStartsWith(resolvedPath, resolvedWorkspace) || pathEquals(resolvedPath, resolvedWorkspace)
      })

      const isSensitive = typeof resolvedPath === 'string' && this.isSensitivePath(resolvedPath)

      return isInside && !isSensitive
    } catch (error) {
      logger.security.error('[Security] Path validation error:', error)
      return false
    }
  }

  /**
   * 检查敏感路径
   */
  isSensitivePath(filePath: string): boolean {
    if (typeof filePath !== 'string') return true
    return sharedIsSensitivePath(filePath)
  }

}

export const securityManager = new SecurityManager()
