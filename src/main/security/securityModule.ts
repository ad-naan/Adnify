/**
 * 安全审计和权限管理模块
 * 统一管理所有敏感操作的权限校验和审计日志
 */

import { logger } from '@shared/utils/Logger'
import * as path from 'path'
import { app, dialog, BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { isSensitivePath as sharedIsSensitivePath } from '@shared/constants'
import { pathStartsWith, pathEquals } from '@shared/utils/pathUtils'
import type { SecuritySettings } from '@shared/config/types'
import { isDangerousOperationWorkspaceTrusted } from '@shared/config/securitySettings'
import type { AppSecurityApprovalRequest } from '@shared/security/executionPolicy'

type ApprovalPresentation = 'native' | 'app'
type ApprovalReason = string | { zh: string; en: string }

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
  requestApproval: (operation: OperationType, target: string, reason: ApprovalReason, presentation?: ApprovalPresentation) => Promise<boolean>

  // 工作区设置
  setWorkspacePath: (workspacePath: string | null) => void

  // 安全操作日志（通过 logger 输出，不写文件）
  logOperation: (operation: OperationType, target: string, success: boolean, detail?: any) => void

  // 工作区安全边界
  validateWorkspacePath: (filePath: string, workspace: string | string[]) => boolean
  isWorkspaceDangerousOperationTrusted: (targetPath: string, workspaceRoots: string[]) => boolean
  isSensitivePath: (filePath: string) => boolean

  // 配置更新
  updateConfig: (config: Partial<SecuritySettings>) => void
  setLanguage: (language: 'zh' | 'en') => void
}

class SecurityManager implements SecurityModule {
  private pendingApprovals = new Map<string, Promise<boolean>>()
  private pendingAppApprovals = new Map<string, {
    senderId: number
    settle: (allowed: boolean) => void
  }>()
  private config: Partial<SecuritySettings> = {}
  private language: 'zh' | 'en' | null = null

  constructor() {
    ipcMain.on('security:approval-response', (event, response: { requestId?: string; allowed?: boolean }) => {
      const requestId = typeof response?.requestId === 'string' ? response.requestId : ''
      const pending = this.pendingAppApprovals.get(requestId)
      if (!pending || pending.senderId !== event.sender.id) return
      pending.settle(response.allowed === true)
    })
  }

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

  setLanguage(language: 'zh' | 'en') {
    this.language = language
  }

  /**
   * Explicit risk approval. Unlike legacy permission levels, this is always
   * shown for an elevated decision and is never cached as a broad grant.
   */
  async requestApproval(
    operation: OperationType,
    target: string,
    reason: ApprovalReason,
    presentation: ApprovalPresentation = 'native',
  ): Promise<boolean> {
    const localizedReason = typeof reason === 'string' ? { zh: reason, en: reason } : reason
    const key = `${presentation}:${operation}:${target}`
    const pending = this.pendingApprovals.get(key)
    if (pending) return pending

    const approval = (async () => {
      const mainWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const allowed = presentation === 'app' && mainWindow
        ? await this.requestAppApproval(mainWindow, { operation, target, reason: localizedReason })
        : await this.requestNativeApproval(mainWindow, { operation, target, reason: localizedReason })
      this.logOperation(operation, target, allowed, {
        reason: localizedReason.zh,
        presentation: presentation === 'app' && mainWindow ? 'app-confirm' : 'native',
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

  private async requestNativeApproval(
    mainWindow: BrowserWindow | null | undefined,
    request: Pick<AppSecurityApprovalRequest, 'operation' | 'target' | 'reason'>,
  ): Promise<boolean> {
    const isZh = this.language ? this.language === 'zh' : app.getLocale().toLowerCase().startsWith('zh')
    const options = {
      type: 'warning' as const,
      buttons: isZh ? ['仅此次允许', '拒绝'] : ['Allow once', 'Deny'],
      defaultId: 1,
      cancelId: 1,
      title: isZh ? '安全审批' : 'Security approval',
      message: isZh ? '此操作需要明确授权' : 'This operation requires explicit approval',
      detail: isZh
        ? `原因：${request.reason.zh}\n\n操作：${request.operation}\n目标：${request.target}`
        : `Reason: ${request.reason.en}\n\nOperation: ${request.operation}\nTarget: ${request.target}`,
      noLink: true,
    }
    const result = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options)
    return result.response === 0
  }

  private requestAppApproval(
    mainWindow: BrowserWindow,
    request: Pick<AppSecurityApprovalRequest, 'operation' | 'target' | 'reason'>,
  ): Promise<boolean> {
    const requestId = randomUUID()
    return new Promise(resolve => {
      let settled = false
      const settle = (allowed: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        mainWindow.webContents.removeListener('destroyed', handleDestroyed)
        this.pendingAppApprovals.delete(requestId)
        resolve(allowed)
      }
      const handleDestroyed = () => settle(false)
      const timer = setTimeout(() => settle(false), 2 * 60_000)
      this.pendingAppApprovals.set(requestId, {
        senderId: mainWindow.webContents.id,
        settle,
      })
      mainWindow.webContents.once('destroyed', handleDestroyed)
      mainWindow.webContents.send('security:approval-request', {
        requestId,
        ...request,
      } satisfies AppSecurityApprovalRequest)
    })
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

  isWorkspaceDangerousOperationTrusted(targetPath: string, workspaceRoots: string[]): boolean {
    if (!targetPath || this.isSensitivePath(targetPath)) return false
    try {
      const resolvedTarget = path.resolve(targetPath)
      const containingRoot = workspaceRoots.find(root => {
        if (typeof root !== 'string') return false
        const resolvedRoot = path.resolve(root)
        return pathStartsWith(resolvedTarget, resolvedRoot) || pathEquals(resolvedTarget, resolvedRoot)
      })
      return Boolean(
        containingRoot
        && isDangerousOperationWorkspaceTrusted(
          containingRoot,
          this.config.trustedDangerousOperationWorkspaceRoots,
        ),
      )
    } catch {
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
