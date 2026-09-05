/**
 * 安全文件操作模块
 * 整合文件操作、工作区管理和文件监听功能
 */

import { logger } from '@shared/utils/Logger'
import { t } from '@shared/i18n'
import { toAppError, ErrorCode } from '@shared/utils/errorHandler'
import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import * as path from 'path'
import { pathToFileURL } from 'url'
import { promises as fsPromises } from 'fs'
import { securityManager, OperationType } from './securityModule'
import { authorizeUserFile, isUserAuthorizedFile } from './userFileAccess'
import * as os from 'os'
import { getUserConfigDir } from '../services/configPath'
import { fileApprovalScope, isRecentAgentApprovalProof, type AgentApprovalProof, type ExecutionReason } from '@shared/security/executionPolicy'

// 导入拆分的模块
import { readFileWithEncodingInfo, readFileSized, readTextFileChunk, writeFileAtomic, getFileStats } from './fileUtils'
import { systemPrivilegeService } from '../services/systemPrivilegeService'
import { isSystemPermissionError } from '@shared/utils/permissionError'
import { mutationFailure, mutationFailureFromError, mutationSuccess } from '../services/fileMutationResult'
import type { FileMutationResult } from '@shared/types/fileMutation'
import {
  setupFileWatcher,
  cleanupFileWatcher,
  FileWatcherEvent,
} from './fileWatcher'
import {
  registerWorkspaceHandlers,
  WindowManagerContext,
} from './workspaceHandlers'
import { openExternalSafely } from './externalUrl'
import { analyzeImage } from '@main/services/documentReader/imageAnalysisService'
import { contentProcess } from '@main/services/documentReader/ContentProcessClient'
import type { ImageAnalysisRequest, ReadRichContentOptions } from '@shared/types'

interface SharedFileRead {
  content: string | null
  size: number
  truncated: boolean
}

const pendingFileReads = new Map<string, Promise<SharedFileRead>>()
const pendingFileWrites = new Map<string, {
  kind: 'replace' | 'append'
  content: string
  encoding: string
  promise: Promise<boolean>
}>()

function isInternalAdnifyPath(filePath: string): boolean {
  return /(?:^|[\\/])\.adnify(?:[\\/]|$)/i.test(filePath)
}

/** 检查是否为合法的全局 Skills、Rules 或 MCP 配置文件路径（允许跨工作区读取） */
function isAllowedGlobalResourcePath(filePath: string): boolean {
  if (!filePath || typeof filePath !== 'string') return false
  try {
    const resolved = path.resolve(filePath).toLowerCase()
    const homeDir = os.homedir().toLowerCase()
    const userConfigDir = getUserConfigDir().toLowerCase()

    const allowedPrefixes = [
      path.join(userConfigDir, 'skills').toLowerCase(),
      path.join(userConfigDir, 'settings').toLowerCase(),
      path.join(homeDir, '.claude', 'skills').toLowerCase(),
      path.join(homeDir, '.codex', 'skills').toLowerCase(),
      path.join(homeDir, '.cursor', 'skills').toLowerCase(),
      path.join(homeDir, '.claude.json').toLowerCase(),
      path.join(homeDir, '.claude', 'mcp.json').toLowerCase(),
      path.join(homeDir, '.claude', 'settings.json').toLowerCase(),
      path.join(homeDir, '.claude', 'claude.md').toLowerCase(),
      path.join(homeDir, '.codex', 'mcp.json').toLowerCase(),
      path.join(homeDir, '.codex', 'instructions.md').toLowerCase(),
      path.join(homeDir, '.cursor', 'mcp.json').toLowerCase(),
    ]

    return allowedPrefixes.some(prefix => resolved.startsWith(prefix) || resolved === prefix)
  } catch {
    return false
  }
}

type FileAccessKind = 'read' | 'write' | 'manage'

/**
 * Single policy entry point for renderer-originated file access.
 * Agent read tools may request an external-file grant under strict mode,
 * or read freely when strict workspace mode is disabled (still blocking sensitive paths).
 */
function canAccessFile(
  filePath: string,
  workspace: { roots: string[] } | null,
  kind: FileAccessKind,
): boolean {
  if (!filePath) return false
  if (isUserAuthorizedFile(filePath, kind)) return true
  if (securityManager.isSensitivePath(filePath)) return false
  if (securityManager.validateWorkspacePath(filePath, workspace?.roots || [])) return true
  return kind === 'read' && isAllowedGlobalResourcePath(filePath)
}

/**
 * Byte size past which a read returns only a leading preview slice.
 *
 * Previews keep the UI responsive on huge files, but a truncated read is
 * indistinguishable from a short file once it crosses the IPC boundary — so any
 * caller that parses the result or writes it back must opt into a full read.
 * `.adnify` project files (settings and analytics) are always read in full:
 * a truncated parse there reads as "empty", and empty round-trips as deletion.
 */
const PREVIEW_BYTE_LIMIT = 5 * 1024 * 1024

function readFileSingleFlight(
  filePath: string,
  encoding?: string,
  full = false,
): Promise<SharedFileRead> {
  // The truncation mode is part of the identity of the read: without it a
  // preview caller and a full caller would share whichever result landed first.
  const key = `${path.resolve(filePath)}\0${encoding || 'auto'}\0${full ? 'full' : 'preview'}`
  const existing = pendingFileReads.get(key)
  if (existing) return existing

  const read = (async () => {
    const result = await readFileSized(
      filePath,
      encoding,
      full ? Number.POSITIVE_INFINITY : PREVIEW_BYTE_LIMIT,
    )
    return { content: result.content, size: result.size, truncated: result.truncated }
  })()

  pendingFileReads.set(key, read)
  void read.finally(() => {
    if (pendingFileReads.get(key) === read) pendingFileReads.delete(key)
  }).catch(() => undefined)
  return read
}

function writeFileSerialized(filePath: string, content: string, encoding: string): Promise<boolean> {
  const key = path.resolve(filePath)
  const existing = pendingFileWrites.get(key)
  if (existing?.kind === 'replace' && existing.content === content && existing.encoding === encoding) return existing.promise

  const previous = existing?.promise ?? Promise.resolve(true)
  const write = previous.catch(() => false).then(async () => {
    await writeFileAtomic(filePath, content, encoding as any)
    return true
  })
  pendingFileWrites.set(key, { kind: 'replace', content, encoding, promise: write })
  void write.finally(() => {
    if (pendingFileWrites.get(key)?.promise === write) pendingFileWrites.delete(key)
  }).catch(() => undefined)
  return write
}

function appendFileSerialized(filePath: string, content: string, encoding: string): Promise<boolean> {
  const key = path.resolve(filePath)
  const previous = pendingFileWrites.get(key)?.promise ?? Promise.resolve(true)
  const append = previous.catch(() => false).then(async () => {
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true })
    await fsPromises.appendFile(filePath, content, { encoding: encoding as BufferEncoding })
    return true
  })
  pendingFileWrites.set(key, { kind: 'append', content, encoding, promise: append })
  void append.finally(() => {
    if (pendingFileWrites.get(key)?.promise === append) pendingFileWrites.delete(key)
  }).catch(() => undefined)
  return append
}

/**
 * 向渲染进程发送错误通知
 */
function showSecurityError(mainWindow: any, title: string, message: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:error', { title, message, variant: 'danger' })
  } else {
    // 如果窗口不可用，回退到原生对话框
    dialog.showErrorBox(title, message)
  }
}

function fileMutationFailure(
  event: Electron.IpcMainInvokeEvent,
  error: unknown,
): FileMutationResult {
  const result = mutationFailureFromError(error, 'file.writeProtected')
  if (!result.success && result.error.code === 'permission_denied') {
    systemPrivilegeService.notifyPermissionRequired(event.sender, 'file.writeProtected')
  }
  return result
}

/**
 * 注册所有安全文件 IPC Handlers
 * 整合文件操作和工作区管理
 */
export function registerSecureFileHandlers(
  getMainWindowFn: () => any,
  store: any,
  getWorkspaceSessionFn: (event?: Electron.IpcMainInvokeEvent) => { roots: string[] } | null,
  windowManager?: WindowManagerContext
) {
   (global as any).mainWindow = getMainWindowFn()

  // 注册工作区相关处理器（从 workspaceHandlers.ts 导入）
  registerWorkspaceHandlers(getMainWindowFn, store, getWorkspaceSessionFn, windowManager)

  // ========== 文件操作处理器 ==========

  // 打开文件（带对话框）
  ipcMain.handle('file:open', async () => {
    const mainWindow = getMainWindowFn()
    if (!mainWindow) return null

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'All Files', extensions: ['*'] }],
    })

    if (!result.canceled && result.filePaths[0]) {
      const filePath = result.filePaths[0]
      if (securityManager.isSensitivePath(filePath)) {
        const approved = await securityManager.requestApproval(
          OperationType.FILE_READ,
          filePath,
          [{ code: 'fileSensitivePath' }],
        )
        if (!approved) return null
      }

      try {
        const content = await fsPromises.readFile(filePath, 'utf-8')
        // Opening a file in the editor implies exact-file read/write authority.
        authorizeUserFile(filePath, 'file-picker', 'write')
        securityManager.logOperation(OperationType.FILE_READ, filePath, true, {
          userAction: true,
          size: content.length,
        })
        return { path: filePath, content }
      } catch (err) {
        logger.security.error('[SecureFile] Failed to read file:', filePath, err)
        securityManager.logOperation(OperationType.FILE_READ, filePath, false, {
          userAction: true,
          error: String(err),
        })
        return null
      }
    }
    return null
  })

  // 读取目录
  ipcMain.handle('file:readDir', async (event, dirPath: string) => {
    if (!dirPath) return []
    if (!canAccessFile(dirPath, getWorkspaceSessionFn(event), 'read')) return []

    try {
      const items = await fsPromises.readdir(dirPath, { withFileTypes: true })
      return items.map((item) => ({
        name: item.name,
        path: path.join(dirPath, item.name),
        isDirectory: item.isDirectory(),
      }))
    } catch {
      return []
    }
  })

  // 获取目录树
  ipcMain.handle('file:getTree', async (event, dirPath: string, maxDepth = 2) => {
    if (!dirPath || maxDepth < 0) return ''
    if (!canAccessFile(dirPath, getWorkspaceSessionFn(event), 'read')) return ''

    const buildTree = async (currentPath: string, currentDepth: number): Promise<string> => {
      if (currentDepth >= maxDepth) return ''
      try {
        const items = await fsPromises.readdir(currentPath, { withFileTypes: true })
        let result = ''
        for (const item of items) {
          const fullPath = path.join(currentPath, item.name)
          const indent = '  '.repeat(currentDepth)
          if (item.isDirectory()) {
            result += `${indent}📁 ${item.name}/\n`
            result += await buildTree(fullPath, currentDepth + 1)
          } else {
            result += `${indent}📄 ${item.name}\n`
          }
        }
        return result
      } catch {
        return ''
      }
    }
    return await buildTree(dirPath, 0)
  })

  // 读取文件（无弹窗，使用拆分的 fileUtils）
  ipcMain.handle('file:read', async (event, filePath: string, encoding?: string, options?: { full?: boolean }) => {
    if (!filePath) return null

    // 跳过虚拟协议路径（如 git-diff://、diff:// 等），这些不是真实文件路径
    if (/^[a-zA-Z][\w-]*:\/\//.test(filePath) && !(/^[a-zA-Z]:\\/.test(filePath))) {
      return null
    }

    const workspace = getWorkspaceSessionFn(event)

    if (!canAccessFile(filePath, workspace, 'read')) {
      securityManager.logOperation(OperationType.FILE_READ, filePath, false, {
        reason: 'hard boundary: path is not authorized',
      })
      return null
    }

    try {
      // Internal .adnify state is never previewed: a truncated parse there is
      // read as "empty", and empty is persisted back as a deletion.
      const full = options?.full === true || isInternalAdnifyPath(filePath)
      const { content, size } = await readFileSingleFlight(filePath, encoding, full)
      // 使用拆分的 fileUtils 函数
      if (!isInternalAdnifyPath(filePath)) {
        securityManager.logOperation(OperationType.FILE_READ, filePath, true, {
          size,
          bypass: true,
        })
      }
      return content
    } catch (err) {
      // 文件不存在是正常情况（如可选的规则文件），不记录为 ERROR
      if (toAppError(err).code === ErrorCode.FILE_NOT_FOUND || (err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        logger.security.debug('[File] not found:', filePath)
      } else {
        logger.security.error('[File] read failed:', filePath, toAppError(err).message)
      }
      return null
    }
  })

  ipcMain.handle('file:readTextChunk', async (
    event,
    filePath: string,
    offset?: number,
    maxBytes?: number,
    alignStartToLine?: boolean,
  ) => {
    if (!filePath || !canAccessFile(filePath, getWorkspaceSessionFn(event), 'read')) return null
    try {
      const chunk = await readTextFileChunk(filePath, offset, maxBytes, alignStartToLine)
      securityManager.logOperation(OperationType.FILE_READ, filePath, true, {
        size: chunk.nextOffset - chunk.startOffset,
        chunked: true,
      })
      return chunk
    } catch (err) {
      logger.security.error('[File] read text chunk failed:', filePath, toAppError(err).message)
      return null
    }
  })

  // 读取二进制文件为 base64
  ipcMain.handle('file:readBinary', async (event, filePath: string) => {
    if (!filePath) return null
    const workspace = getWorkspaceSessionFn(event)

    if (!canAccessFile(filePath, workspace, 'read')) {
      securityManager.logOperation(OperationType.FILE_READ, filePath, false, {
        reason: 'hard boundary: path is not authorized',
      })
      return null
    }

    try {
      const stats = await fsPromises.stat(filePath)
      if (stats.size > 50 * 1024 * 1024) {
        return null
      }

      const buffer = await fsPromises.readFile(filePath)
      const base64 = buffer.toString('base64')

      securityManager.logOperation(OperationType.FILE_READ, filePath, true, {
        size: stats.size,
        binary: true,
      })
      return base64
    } catch (err) {
      logger.security.error('[File] read binary failed:', filePath, toAppError(err).message)
      return null
    }
  })

  // 读取富文档（PDF / Office 等），并在可用时联动分析嵌图
  ipcMain.handle('file:readRichContent', async (event, filePath: string, options?: ReadRichContentOptions) => {
    if (!filePath) {
      return {
        success: false,
        error: 'Error: Missing file path',
        contentKind: 'unknown',
        sourceFormat: 'unknown',
      }
    }

    const workspace = getWorkspaceSessionFn(event)
    if (!canAccessFile(filePath, workspace, 'read')) {
      securityManager.logOperation(OperationType.FILE_READ, filePath, false, {
        reason: 'hard boundary: path is not authorized',
        richContent: true,
      })
      return {
        success: false,
        error: 'Error: File path is outside the active workspace.',
        contentKind: 'unknown',
        sourceFormat: path.extname(filePath).replace('.', '').toLowerCase() || 'unknown',
      }
    }

    const imageAnalysisConfig = options?.imageAnalysis?.config
    const result = await contentProcess.readRichContent(filePath, {
      embeddedImageAnalyzer: imageAnalysisConfig
        ? async (image) => {
            const analysis = await analyzeImage({
              config: imageAnalysisConfig,
              prompt: options?.imageAnalysis?.prompt
                || `Analyze this embedded document image (${image.displayName}). Extract visible text, chart or table data, layout, and key details that help understand the surrounding document.`,
              image,
            })
            return analysis.success ? (analysis.content || '') : `Image analysis failed: ${analysis.error || 'Unknown error'}`
          }
        : undefined,
      skipImageAnalysisReason: imageAnalysisConfig ? undefined : 'no multimodal model configured',
    })

    securityManager.logOperation(OperationType.FILE_READ, filePath, result.success, {
      richContent: true,
      contentKind: result.contentKind,
      sourceFormat: result.sourceFormat,
      embeddedImageCount: result.embeddedImageCount || 0,
      embeddedImagesAnalyzed: result.embeddedImagesAnalyzed || 0,
      usedFallback: result.usedFallback || false,
    })
    return result
  })

  // 读取并分析图片，返回分析文本和预览数据
  ipcMain.handle('file:readImageAnalysis', async (event, request: ImageAnalysisRequest) => {
    const targetPath = typeof request?.path === 'string' ? request.path : undefined
    const workspace = getWorkspaceSessionFn(event)

    if (targetPath) {
      if (!canAccessFile(targetPath, workspace, 'read')) {
        securityManager.logOperation(OperationType.FILE_READ, targetPath, false, {
          reason: 'hard boundary: path is not authorized',
          imageAnalysis: true,
        })
        return {
          success: false,
          error: 'Error: File path is outside the active workspace.',
        }
      }

    }

    const result = await analyzeImage(request)
    securityManager.logOperation(OperationType.FILE_READ, targetPath || request?.image?.displayName || '<inline-image>', result.success, {
      imageAnalysis: true,
      inlineImage: !targetPath,
    })
    return result
  })

  // 写入文件（无弹窗）
  ipcMain.handle('file:write', async (event, filePath: string, content: string, encoding?: string) => {
    if (!filePath || typeof filePath !== 'string') return mutationFailure('invalid_request')
    if (content === undefined || content === null) return mutationFailure('invalid_request')

    const workspace = getWorkspaceSessionFn(event)

    if (!canAccessFile(filePath, workspace, 'write')) {
      securityManager.logOperation(OperationType.FILE_WRITE, filePath, false, {
        reason: 'hard boundary: path is not authorized',
      })
      return mutationFailure('policy_denied', 'Path is not authorized for writing.')
    }

    // 禁止类型检查
    const forbiddenPatterns = [/\.exe$/i, /\.dll$/i, /\.sys$/i, /\.tmp$/i, /\.temp$/i]
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(filePath)) {
        securityManager.logOperation(OperationType.FILE_WRITE, filePath, false, {
          reason: 'hard boundary: forbidden file type',
        })
        return mutationFailure('policy_denied', 'This file type cannot be written.')
      }
    }

    try {
      const success = await writeFileSerialized(filePath, content, encoding || 'utf-8')
      if (!success) {
        return mutationFailure('io_error', 'The file could not be written.')
      }
      if (!isInternalAdnifyPath(filePath)) {
        securityManager.logOperation(OperationType.FILE_WRITE, filePath, true, {
          size: content.length,
          bypass: true,
        })
      }
      return mutationSuccess()
    } catch (err) {
      logger.security.error('[File] write failed:', filePath, toAppError(err).message)
      return fileMutationFailure(event, err)
    }
  })

  // Append-only project logs avoid reading and rewriting an ever-growing file.
  ipcMain.handle('file:append', async (event, filePath: string, content: string, encoding?: string) => {
    if (!filePath || typeof filePath !== 'string' || !content) return mutationFailure('invalid_request')
    // Append is intentionally narrower than general writes: it exists for
    // internal append-only journals, not arbitrary renderer file mutation.
    if (!isInternalAdnifyPath(filePath)) return mutationFailure('policy_denied')
    const workspace = getWorkspaceSessionFn(event)
    if (!canAccessFile(filePath, workspace, 'write')) return mutationFailure('policy_denied')
    try {
      await appendFileSerialized(filePath, content, encoding || 'utf-8')
      return mutationSuccess()
    } catch (err) {
      logger.security.error('[File] append failed:', filePath, toAppError(err).message)
      return fileMutationFailure(event, err)
    }
  })

  // 确保目录存在
  ipcMain.handle('file:ensureDir', async (event, dirPath: string) => {
    if (!dirPath) return mutationFailure('invalid_request')
    const workspace = getWorkspaceSessionFn(event)
    if (!canAccessFile(dirPath, workspace, 'manage')) return mutationFailure('policy_denied')
    try {
      await fsPromises.mkdir(dirPath, { recursive: true })
      return mutationSuccess()
    } catch (err) {
      return fileMutationFailure(event, err)
    }
  })

  // 保存文件（带对话框支持）
  ipcMain.handle('file:save', async (event, content: string, currentPath?: string, encoding?: string) => {
    if (currentPath) {
      const workspace = getWorkspaceSessionFn(event)
      if (!canAccessFile(currentPath, workspace, 'write')) {
        securityManager.logOperation(OperationType.FILE_WRITE, currentPath, false, {
          reason: 'hard boundary: path is not authorized',
        })
        return null
      }

      try {
        await writeFileAtomic(currentPath, content, (encoding as any) || 'utf-8')
        securityManager.logOperation(OperationType.FILE_WRITE, currentPath, true)
        return currentPath
      } catch (err) {
        if (isSystemPermissionError(err)) {
          systemPrivilegeService.notifyPermissionRequired(event.sender, 'file.writeProtected')
        }
        return null
      }
    }

    // 新建文件：需要选择路径
    const mainWindow = getMainWindowFn()
    if (!mainWindow) return null

    const workspace = getWorkspaceSessionFn(event)
    const defaultPath =
      workspace && workspace.roots.length > 0 ? workspace.roots[0] : os.homedir()

    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath,
      filters: [{ name: 'All Files', extensions: ['*'] }],
    })

    if (!result.canceled && result.filePath) {
      const savePath = result.filePath
      if (securityManager.isSensitivePath(savePath)) {
        const language = securityManager.uiLanguage()
        showSecurityError(
          mainWindow,
          t('securityApproval.sensitiveSaveTitle', language),
          t('securityApproval.sensitiveSaveBlocked', language),
        )
        return null
      }

      try {
        await writeFileAtomic(savePath, content, (encoding as any) || 'utf-8')
        authorizeUserFile(savePath, 'save-picker', 'write')
        securityManager.logOperation(OperationType.FILE_WRITE, savePath, true, {
          isNewFile: true,
          bypass: true,
        })
        return savePath
      } catch (err) {
        if (isSystemPermissionError(err)) {
          systemPrivilegeService.notifyPermissionRequired(event.sender, 'file.writeProtected')
        }
        return null
      }
    }
    return null
  })

  // 文件是否存在
  ipcMain.handle('file:exists', async (event, filePath: string) => {
    const workspace = getWorkspaceSessionFn(event)
    if (!canAccessFile(filePath, workspace, 'read')) return false

    try {
      await fsPromises.access(filePath)
      return true
    } catch {
      return false
    }
  })

  // 文件大小/类型（读取前判断，避免大文件被预览截断后无法察觉）
  ipcMain.handle('file:stat', async (event, filePath: string) => {
    if (!filePath || typeof filePath !== 'string') return null
    const workspace = getWorkspaceSessionFn(event)
    if (!canAccessFile(filePath, workspace, 'read')) return null

    const stats = await getFileStats(filePath)
    if (!stats) return null

    return {
      size: stats.size,
      isDirectory: stats.isDirectory,
      isFile: stats.isFile,
      mtimeMs: stats.mtime.getTime(),
    }
  })

  // 创建目录（无弹窗）
  ipcMain.handle('file:mkdir', async (event, dirPath: string) => {
    if (!dirPath || typeof dirPath !== 'string') return mutationFailure('invalid_request')
    const workspace = getWorkspaceSessionFn(event)
    if (!canAccessFile(dirPath, workspace, 'manage')) return mutationFailure('policy_denied')

    try {
      await fsPromises.mkdir(dirPath, { recursive: true })
      securityManager.logOperation(OperationType.FILE_WRITE, dirPath, true, {
        isDirectory: true,
        bypass: true,
      })
      return mutationSuccess()
    } catch (err) {
      logger.security.error('[File] mkdir failed:', dirPath, toAppError(err).message)
      return fileMutationFailure(event, err)
    }
  })

  // 递归计算目录大小
  async function calculateDirectorySize(dirPath: string): Promise<number> {
    let totalSize = 0
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        totalSize += await calculateDirectorySize(entryPath)
      } else {
        const stat = await fsPromises.stat(entryPath)
        totalSize += stat.size
      }
      // 提前退出：超过阈值无需继续统计
      if (totalSize > 100 * 1024 * 1024) break
    }
    return totalSize
  }

  // 删除文件/目录：主进程边界做单次审批，避免依赖可绕过的渲染层状态。
  ipcMain.handle('file:delete', async (event, filePath: string, approval?: AgentApprovalProof) => {
    if (!filePath) return mutationFailure('invalid_request')
    const workspace = getWorkspaceSessionFn(event)
    const hasExactManageGrant = isUserAuthorizedFile(filePath, 'manage')
    if (!canAccessFile(filePath, workspace, 'manage')) {
      securityManager.logOperation(OperationType.FILE_DELETE, filePath, false, {
        reason: 'hard boundary: outside the workspace',
      })
      return mutationFailure('policy_denied', 'Path is outside the authorized workspace.')
    }

    const riskReasons: ExecutionReason[] = []

    // 关键配置文件需要更明确的审批，而不是直接拒绝。
    const criticalFiles = [/\.env$/i, /package-lock\.json$/i, /yarn\.lock$/i, /pnpm-lock\.yaml$/i]
    for (const pattern of criticalFiles) {
      if (pattern.test(filePath)) {
        riskReasons.push({ code: 'fileCriticalConfig' })
        break
      }
    }

    // 大目录同样进入审批；无效或不可访问的目标才直接失败。
    let targetStat: Awaited<ReturnType<typeof fsPromises.lstat>>
    try {
      targetStat = await fsPromises.lstat(filePath)
      if (targetStat.isDirectory()) {
        const dirSize = await calculateDirectorySize(filePath)
        if (dirSize > 100 * 1024 * 1024) {
          const size = (dirSize / 1024 / 1024).toFixed(1)
          riskReasons.push({ code: 'fileLargeDirectory', params: { size } })
        }
      }
    } catch (err) {
      return fileMutationFailure(event, err)
    }

    const normalizedFilePath = path.resolve(filePath)
    const isInsideWorkspace = workspace?.roots.some(root => {
      const relative = path.relative(path.resolve(root), normalizedFilePath)
      return !relative.startsWith('..') && !path.isAbsolute(relative)
    }) ?? false
    const isInternalAgentTemp = workspace?.roots.some(root => {
      const relative = path.relative(path.resolve(root), normalizedFilePath)
      return !relative.startsWith('..') && !path.isAbsolute(relative)
        && /^\.adnify[\\/]agent-temp[\\/]inline-[^\\/]+$/i.test(relative)
    }) ?? false
    const isTrustedWorkspaceOperation = securityManager.isWorkspaceDangerousOperationTrusted(
      normalizedFilePath,
      workspace?.roots || [],
    )
    const hasAgentApproval = isRecentAgentApprovalProof(
      approval,
      fileApprovalScope(normalizedFilePath, 'manage'),
    )
    if (approval && !hasAgentApproval) {
      securityManager.logOperation(OperationType.FILE_DELETE, filePath, false, {
        reason: 'agent dock approval proof is invalid, expired, or mismatched',
      })
      return mutationFailure('policy_denied', 'Approval proof is invalid or expired.')
    }
    if (!hasExactManageGrant && !hasAgentApproval && !isInternalAgentTemp && !isTrustedWorkspaceOperation) {
      const approved = await securityManager.requestApproval(
        OperationType.FILE_DELETE,
        filePath,
        [{ code: 'fileDeleteIrreversible' }, ...riskReasons],
        isInsideWorkspace ? 'app' : 'native',
      )
      if (!approved) return mutationFailure('policy_denied', 'Deletion was not approved.')
    }

    try {
      if (targetStat.isDirectory()) {
        await fsPromises.rm(filePath, { recursive: true, force: true })
      } else {
        await fsPromises.unlink(filePath)
      }
      securityManager.logOperation(OperationType.FILE_DELETE, filePath, true, {
        size: targetStat.size,
        approval: hasExactManageGrant
          ? 'exact-path-grant'
          : hasAgentApproval
            ? 'agent-dock'
            : isTrustedWorkspaceOperation
              ? 'trusted-workspace'
              : isInternalAgentTemp
                ? 'internal-agent-temp'
                : 'approved-once',
      })
      return mutationSuccess()
    } catch (err) {
      logger.security.error('[File] delete failed:', filePath, toAppError(err).message)
      return fileMutationFailure(event, err)
    }
  })

  // 复制文件（无弹窗）
  ipcMain.handle('file:copy', async (event, sourcePath: string, destinationPath: string) => {
    if (!sourcePath || !destinationPath) return mutationFailure('invalid_request')
    const workspace = getWorkspaceSessionFn(event)
    if (!canAccessFile(sourcePath, workspace, 'manage') || !canAccessFile(destinationPath, workspace, 'manage')) {
      securityManager.logOperation(OperationType.FILE_WRITE, sourcePath, false, {
        reason: 'hard boundary: outside the workspace',
        destinationPath,
      })
      return mutationFailure('policy_denied', 'Source or destination is outside the authorized workspace.')
    }

    try {
      const stat = await fsPromises.stat(sourcePath)
      await fsPromises.mkdir(path.dirname(destinationPath), { recursive: true })
      if (stat.isDirectory()) {
        await fsPromises.cp(sourcePath, destinationPath, {
          recursive: true,
          errorOnExist: true,
          force: false,
        })
      } else {
        await fsPromises.copyFile(sourcePath, destinationPath)
      }
      securityManager.logOperation(OperationType.FILE_WRITE, sourcePath, true, {
        destinationPath,
        isDirectory: stat.isDirectory(),
        bypass: true,
      })
      return mutationSuccess()
    } catch (err) {
      logger.security.error('[File] copy failed:', sourcePath, toAppError(err).message)
      return fileMutationFailure(event, err)
    }
  })

  // 重命名文件（无弹窗）
  ipcMain.handle('file:rename', async (event, oldPath: string, newPath: string) => {
    if (!oldPath || !newPath) return mutationFailure('invalid_request')
    const workspace = getWorkspaceSessionFn(event)
    if (!canAccessFile(oldPath, workspace, 'manage') || !canAccessFile(newPath, workspace, 'manage')) {
      securityManager.logOperation(OperationType.FILE_RENAME, oldPath, false, {
        reason: 'hard boundary: outside the workspace',
        newPath,
      })
      return mutationFailure('policy_denied', 'Source or destination is outside the authorized workspace.')
    }

    try {
      await fsPromises.rename(oldPath, newPath)
      securityManager.logOperation(OperationType.FILE_RENAME, oldPath, true, {
        newPath,
        bypass: true,
      })
      return mutationSuccess()
    } catch (err) {
      logger.security.error('[File] rename failed:', oldPath, toAppError(err).message)
      return fileMutationFailure(event, err)
    }
  })

  // 在文件管理器中显示
  ipcMain.handle('file:showInFolder', async (_, filePath: string) => {
    try {
      await fsPromises.access(filePath)
      shell.showItemInFolder(filePath)
      return true
    } catch {
      return false
    }
  })

  // 设置面板中的明确“在编辑器中打开”操作，只为当前工作区或受信任的
  // Adnify 配置资源授予本次应用会话内的精确文件写权限。
  ipcMain.handle('file:authorizeSettingsEdit', async (event, filePath: string, initialContent?: string) => {
    if (!filePath || typeof filePath !== 'string') return mutationFailure('invalid_request')
    if (securityManager.isSensitivePath(filePath)) return mutationFailure('policy_denied')
    const workspace = getWorkspaceSessionFn(event)
    if (!securityManager.validateWorkspacePath(filePath, workspace?.roots || []) && !isAllowedGlobalResourcePath(filePath)) {
      return mutationFailure('policy_denied')
    }
    authorizeUserFile(filePath, 'settings-editor', 'write')

    if (typeof initialContent === 'string') {
      try {
        await fsPromises.mkdir(path.dirname(filePath), { recursive: true })
        await fsPromises.writeFile(filePath, initialContent, { encoding: 'utf-8', flag: 'wx' })
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EEXIST') {
          logger.security.error('[File] Failed to initialize settings file:', filePath, toAppError(error).message)
          return fileMutationFailure(event, error)
        }
      }
    }
    return mutationSuccess()
  })

  // 在浏览器中打开文件
  ipcMain.handle('file:openInBrowser', async (_, filePath: string) => {
    try {
      // 验证文件存在
      await fsPromises.access(filePath)
      // 转换为 file:// URL
      const fileUrl = pathToFileURL(filePath).href
      return await openExternalSafely(fileUrl)
    } catch {
      return false
    }
  })

  // 文件监听（使用拆分的 fileWatcher）
  ipcMain.handle('file:watch', (_, action: string) => {
    if (action === 'start') {
      const win = getMainWindowFn()
      const workspace = getWorkspaceSessionFn()
      if (win && workspace?.roots?.[0]) {
        // 批量转发：git checkout / 依赖安装会一次产生上千个事件，
        // 逐个 send 会让渲染进程被 IPC 淹没。这里按 ~30fps 聚合，
        // 同一路径只保留最后一次事件（Map 保序，先到先发），
        // 因为下游 handler 关心的是文件的最终状态。
        const pending = new Map<string, FileWatcherEvent>()
        let flushTimer: NodeJS.Timeout | null = null
        let draining = false
        const maxEventsPerTurn = 128

        const drain = () => {
          if (win.isDestroyed()) {
            pending.clear()
            draining = false
            return
          }

          const batch: FileWatcherEvent[] = []
          for (const [filePath, item] of pending) {
            pending.delete(filePath)
            batch.push(item)
            if (batch.length >= maxEventsPerTurn) break
          }
          for (const item of batch) {
            win.webContents.send('file:changed', item)
          }

          if (pending.size > 0) setImmediate(drain)
          else draining = false
        }

        const flush = () => {
          flushTimer = null
          if (pending.size === 0 || draining) return
          draining = true
          drain()
        }

        void setupFileWatcher(`window-${win.webContents.id}`, workspace.roots[0], (data: FileWatcherEvent) => {
          pending.set(data.path, data)
          if (!draining && flushTimer === null) {
            flushTimer = setTimeout(flush, 33)
          }
        })
      }
    } else if (action === 'stop') {
      const win = getMainWindowFn()
      void cleanupFileWatcher(win ? `window-${win.webContents.id}` : undefined)
    }
  })

  /**
   * Agent tools may need an exact external-file grant under strict workspace mode.
   * Approval is rendered in the existing tool Dock; this handler only validates
   * its scoped proof and never opens a second native dialog.
   */
  ipcMain.handle('security:requestExternalFileAccess', async (
    _event,
    filePath: string,
    access: FileAccessKind = 'read',
    approval?: AgentApprovalProof,
  ) => {
    if (!filePath || typeof filePath !== 'string') {
      return { allowed: false, reason: 'invalid-path' as const }
    }
    if (isUserAuthorizedFile(filePath, access)) {
      return { allowed: true, reason: 'already-granted' as const }
    }

    const normalizedFilePath = path.resolve(filePath)
    if (isRecentAgentApprovalProof(approval, fileApprovalScope(normalizedFilePath, access))) {
      const source = access === 'read' ? 'agent-read' : access === 'write' ? 'agent-write' : 'agent-manage'
      authorizeUserFile(filePath, source, access)
      return { allowed: true, reason: 'agent-approved' as const }
    }
    return { allowed: false, reason: approval ? ('approval-invalid' as const) : ('approval-required' as const) }
  })
}

/**
 * 清理安全文件监听器
 * 导出以便外部调用
 */
export function cleanupSecureFileWatcher() {
  cleanupFileWatcher()
}

// 导出安全管理器
export { securityManager }

// 重新导出拆分模块的类型和函数，方便外部使用
export type { FileWatcherEvent, WindowManagerContext }
export { setupFileWatcher, cleanupFileWatcher } from './fileWatcher'
