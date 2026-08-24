/**
 * LSP IPC 处理器
 */

import { logger } from '@shared/utils/Logger'
import { toAppError } from '@shared/utils/errorHandler'
import { ipcMain } from 'electron'
import { lspManager, LanguageId } from '../lsp/lspManager'
import { getLanguageFromPath, isLspSupported } from '@shared/languages'
import {
  getLspServerStatus,
  installServer,
  installBasicServers,
  getLspBinDir,
  getDefaultLspBinDir,
  setCustomLspBinDir,
} from '../lsp/installer'
import { pathToLspUri } from '@shared/utils/uriUtils'
import {
  getLanguageEnv,
  setLanguageEnv,
  removeLanguageEnv,
  getAllLanguageEnv,
  resolveRuntimePath,
} from '../lsp/languageEnvConfig'
import { lspUriToPath } from '@shared/utils/uriUtils'
import { authorizeUserFile } from '../security/userFileAccess'

const NAVIGATION_METHODS = new Set([
  'textDocument/definition',
  'textDocument/typeDefinition',
  'textDocument/implementation',
])

function authorizeNavigationTargets(result: unknown): void {
  const locations = Array.isArray(result) ? result : result ? [result] : []
  for (const location of locations) {
    if (!location || typeof location !== 'object') continue
    const value = location as { uri?: unknown; targetUri?: unknown }
    const uri = typeof value.targetUri === 'string'
      ? value.targetUri
      : typeof value.uri === 'string'
        ? value.uri
        : null
    if (uri?.toLowerCase().startsWith('file://')) {
      try {
        authorizeUserFile(lspUriToPath(uri), 'lsp-navigation')
      } catch {
        // Ignore one malformed server location without discarding valid results.
      }
    }
  }
}

function getFallbackRoot(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash <= 0) return normalized || '/'
  return normalized.slice(0, lastSlash)
}

function getLanguageId(filePath: string): LanguageId | null {
  const languageId = getLanguageFromPath(filePath)
  return isLspSupported(languageId) ? languageId as LanguageId : null
}

function getLanguageIdFromUri(uri: string): string {
  const filePath = lspUriToPath(uri)
  return getLanguageId(filePath) || 'plaintext'
}

async function getServerForUri(uri: string, workspacePath: string): Promise<string | null> {
  const filePath = lspUriToPath(uri)
  const effectiveWorkspacePath = workspacePath || getFallbackRoot(filePath)

  const languageId = getLanguageId(filePath)
  if (!languageId) return null

  // 使用智能根目录检测启动服务器
  return lspManager.ensureServerForFile(filePath, languageId, effectiveWorkspacePath)
}

function logLspRequestFailure(method: string, err: unknown): void {
  logger.lsp.debug(`[LSP IPC] ${method} failed:`, toAppError(err).message)
}

// preferencesStore 引用，用于保存 LSP 配置
let _preferencesStore: any = null

export function registerLspHandlers(preferencesStore?: any): void {
  _preferencesStore = preferencesStore
  const observedDocumentOwners = new Set<number>()

  const closeReleasedDocuments = (documents: Array<{ serverKey: string; uri: string }>) => {
    for (const { serverKey, uri } of documents) {
      lspManager.sendNotification(serverKey, 'textDocument/didClose', {
        textDocument: { uri },
      })
    }
  }

  const observeDocumentOwner = (sender: Electron.WebContents) => {
    if (observedDocumentOwners.has(sender.id)) return
    const ownerId = sender.id
    observedDocumentOwners.add(ownerId)
    sender.once('destroyed', () => {
      observedDocumentOwners.delete(ownerId)
      closeReleasedDocuments(lspManager.releaseDocumentOwner(ownerId))
    })
  }

  // 启动服务器
  ipcMain.handle('lsp:start', async (_, workspacePath: string) => {
    const success = await lspManager.startServer('typescript', workspacePath)
    return { success }
  })

  // 启动指定语言的服务器
  ipcMain.handle('lsp:startForLanguage', async (_, params: { languageId: LanguageId; workspacePath: string }) => {
    const serverName = await lspManager.ensureServerForLanguage(params.languageId, params.workspacePath)
    return { success: !!serverName, serverName }
  })

  // 停止服务器
  ipcMain.handle('lsp:stop', async () => {
    await lspManager.stopAllServers()
    return { success: true }
  })

  // 获取运行中的服务器
  ipcMain.handle('lsp:getRunningServers', () => lspManager.getRunningServers())

  // ============ 文档同步 ============

  ipcMain.handle('lsp:didOpen', async (event, params: { uri: string; languageId: string; version: number; text: string; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) {
      logger.lsp.warn('[LSP IPC] didOpen skipped: no server available', {
        uri: params.uri,
        languageId: params.languageId,
        workspacePath: params.workspacePath || '',
      })
      return { success: false, serverName: null }
    }

    observeDocumentOwner(event.sender)
    const sync = lspManager.syncDocument(serverName, params.uri, params.languageId, params.text, event.sender.id)
    if (sync.action === 'open') {
      lspManager.sendNotification(serverName, 'textDocument/didOpen', {
        textDocument: { uri: params.uri, languageId: params.languageId, version: sync.version, text: params.text },
      })
    } else if (sync.action === 'change') {
      lspManager.sendNotification(serverName, 'textDocument/didChange', {
        textDocument: { uri: params.uri, version: sync.version },
        contentChanges: [{ text: params.text }],
      })
    }
    return { success: true, serverName }
  })

  ipcMain.handle('lsp:didChange', async (event, params: { uri: string; version: number; text: string; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return

    observeDocumentOwner(event.sender)
    const languageId = getLanguageIdFromUri(params.uri)
    const sync = lspManager.syncDocument(serverName, params.uri, languageId, params.text, event.sender.id)
    if (sync.action === 'open') {
      lspManager.sendNotification(serverName, 'textDocument/didOpen', {
        textDocument: { uri: params.uri, languageId, version: sync.version, text: params.text },
      })
      return
    }
    if (sync.action === 'change') {
      lspManager.sendNotification(serverName, 'textDocument/didChange', {
        textDocument: { uri: params.uri, version: sync.version },
        contentChanges: [{ text: params.text }],
      })
    }
  })

  ipcMain.handle('lsp:didClose', async (event, params: { uri: string; workspacePath?: string }) => {
    closeReleasedDocuments(lspManager.releaseDocumentForOwner(params.uri, event.sender.id))
  })

  // 文档保存通知
  ipcMain.handle('lsp:didSave', async (_, params: { uri: string; text?: string; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return

    lspManager.sendNotification(serverName, 'textDocument/didSave', {
      textDocument: { uri: params.uri },
      text: params.text, // 可选，取决于 capability
    })
  })

  // ============ LSP 请求 ============

  const createPositionHandler = (method: string) => {
    return async (_: any, params: { uri: string; line: number; character: number; workspacePath?: string }) => {
      const serverName = await getServerForUri(params.uri, params.workspacePath || '')
      if (!serverName) return null

      try {
        const result = await lspManager.sendRequest(serverName, method, {
          textDocument: { uri: params.uri },
          position: { line: params.line, character: params.character },
        })
        if (NAVIGATION_METHODS.has(method)) authorizeNavigationTargets(result)
        if (method === 'textDocument/definition') {
          logger.lsp.info('[LSP IPC] Definition result:', {
            serverName,
            uri: params.uri,
            line: params.line,
            character: params.character,
            isArray: Array.isArray(result),
            count: Array.isArray(result) ? result.length : (result ? 1 : 0),
            sampleKeys: result && !Array.isArray(result) ? Object.keys(result) : (Array.isArray(result) && result[0] ? Object.keys(result[0]) : []),
          })
        }
        return result
      } catch (err) {
        logLspRequestFailure(method, err)
        return null
      }
    }
  }

  ipcMain.handle('lsp:definition', createPositionHandler('textDocument/definition'))
  ipcMain.handle('lsp:typeDefinition', createPositionHandler('textDocument/typeDefinition'))
  ipcMain.handle('lsp:implementation', createPositionHandler('textDocument/implementation'))
  ipcMain.handle('lsp:hover', createPositionHandler('textDocument/hover'))
  ipcMain.handle('lsp:completion', createPositionHandler('textDocument/completion'))
  ipcMain.handle('lsp:signatureHelp', createPositionHandler('textDocument/signatureHelp'))
  ipcMain.handle('lsp:documentHighlight', createPositionHandler('textDocument/documentHighlight'))
  ipcMain.handle('lsp:prepareRename', createPositionHandler('textDocument/prepareRename'))

  ipcMain.handle('lsp:references', async (_, params: { uri: string; line: number; character: number; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      return await lspManager.sendRequest(serverName, 'textDocument/references', {
        textDocument: { uri: params.uri },
        position: { line: params.line, character: params.character },
        context: { includeDeclaration: true },
      })
    } catch (err) {
      logLspRequestFailure('textDocument/references', err)
      return null
    }
  })

  ipcMain.handle('lsp:completionResolve', async (_, item: any) => {
    const running = lspManager.getRunningServers()
    if (running.length === 0) return item

    try {
      return await lspManager.sendRequest(running[0], 'completionItem/resolve', item)
    } catch (err) {
      logLspRequestFailure('completionItem/resolve', err)
      return item
    }
  })

  ipcMain.handle('lsp:documentSymbol', async (_, params: { uri: string; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      return await lspManager.sendRequest(serverName, 'textDocument/documentSymbol', {
        textDocument: { uri: params.uri },
      })
    } catch (err) {
      logLspRequestFailure('textDocument/documentSymbol', err)
      return null
    }
  })

  ipcMain.handle('lsp:workspaceSymbol', async (_, params: { query: string; workspacePath?: string }) => {
    const running = lspManager.getRunningServers(params.workspacePath)
    if (running.length === 0) return []

    const results = await Promise.all(
      running.map(async (serverName) => {
        try {
          return await lspManager.sendRequest(serverName, 'workspace/symbol', { query: params.query })
        } catch (err) {
          logLspRequestFailure('workspace/symbol', err)
          return []
        }
      })
    )
    return results.flat()
  })

  ipcMain.handle('lsp:rename', async (_, params: { uri: string; line: number; character: number; newName: string; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      return await lspManager.sendRequest(serverName, 'textDocument/rename', {
        textDocument: { uri: params.uri },
        position: { line: params.line, character: params.character },
        newName: params.newName,
      })
    } catch (err) {
      logLspRequestFailure('textDocument/rename', err)
      return null
    }
  })

  ipcMain.handle('lsp:codeAction', async (_, params: { uri: string; range: any; diagnostics?: any[]; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      return await lspManager.sendRequest(serverName, 'textDocument/codeAction', {
        textDocument: { uri: params.uri },
        range: params.range,
        context: { diagnostics: params.diagnostics || [], only: ['quickfix', 'refactor', 'source'] },
      })
    } catch (err) {
      logLspRequestFailure('textDocument/codeAction', err)
      return null
    }
  })

  ipcMain.handle('lsp:formatting', async (_, params: { uri: string; options?: any; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      return await lspManager.sendRequest(serverName, 'textDocument/formatting', {
        textDocument: { uri: params.uri },
        options: params.options || { tabSize: 2, insertSpaces: true },
      })
    } catch (err) {
      logLspRequestFailure('textDocument/formatting', err)
      return null
    }
  })

  ipcMain.handle('lsp:rangeFormatting', async (_, params: { uri: string; range: any; options?: any; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      return await lspManager.sendRequest(serverName, 'textDocument/rangeFormatting', {
        textDocument: { uri: params.uri },
        range: params.range,
        options: params.options || { tabSize: 2, insertSpaces: true },
      })
    } catch (err) {
      logLspRequestFailure('textDocument/rangeFormatting', err)
      return null
    }
  })

  ipcMain.handle('lsp:foldingRange', async (_, params: { uri: string; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      return await lspManager.sendRequest(serverName, 'textDocument/foldingRange', {
        textDocument: { uri: params.uri },
      })
    } catch (err) {
      logLspRequestFailure('textDocument/foldingRange', err)
      return null
    }
  })

  ipcMain.handle('lsp:inlayHint', async (_, params: { uri: string; range: any; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      return await lspManager.sendRequest(serverName, 'textDocument/inlayHint', {
        textDocument: { uri: params.uri },
        range: params.range,
      })
    } catch (err) {
      logLspRequestFailure('textDocument/inlayHint', err)
      return null
    }
  })

  ipcMain.handle('lsp:getDiagnostics', (_, filePath: string) => {
    return lspManager.getDiagnostics(pathToLspUri(filePath))
  })

  // ============ Call Hierarchy 支持 ============

  ipcMain.handle('lsp:prepareCallHierarchy', async (_, params: { uri: string; line: number; character: number; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      return await lspManager.prepareCallHierarchy(serverName, params.uri, params.line, params.character)
    } catch (err) {
      logLspRequestFailure('textDocument/prepareCallHierarchy', err)
      return null
    }
  })

  ipcMain.handle('lsp:incomingCalls', async (_, params: { uri: string; line: number; character: number; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      // 先获取 call hierarchy item
      const items = await lspManager.prepareCallHierarchy(serverName, params.uri, params.line, params.character)
      if (!items || items.length === 0) return []

      // 获取 incoming calls
      return await lspManager.getIncomingCalls(serverName, items[0])
    } catch (err) {
      logLspRequestFailure('callHierarchy/incomingCalls', err)
      return null
    }
  })

  ipcMain.handle('lsp:outgoingCalls', async (_, params: { uri: string; line: number; character: number; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      // 先获取 call hierarchy item
      const items = await lspManager.prepareCallHierarchy(serverName, params.uri, params.line, params.character)
      if (!items || items.length === 0) return []

      // 获取 outgoing calls
      return await lspManager.getOutgoingCalls(serverName, items[0])
    } catch (err) {
      logLspRequestFailure('callHierarchy/outgoingCalls', err)
      return null
    }
  })

  // ============ waitForDiagnostics 支持 ============

  ipcMain.handle('lsp:waitForDiagnostics', async (_, params: { uri: string }) => {
    try {
      await lspManager.waitForDiagnostics(params.uri)
      return { success: true }
    } catch (err) {
      logLspRequestFailure('waitForDiagnostics', err)
      return { success: false }
    }
  })

  // ============ 智能根目录检测 ============

  ipcMain.handle('lsp:findBestRoot', async (_, params: { filePath: string; languageId: LanguageId; workspacePath: string }) => {
    try {
      return await lspManager.findBestRoot(params.filePath, params.languageId, params.workspacePath)
    } catch (err) {
      logLspRequestFailure('findBestRoot', err)
      return params.workspacePath
    }
  })

  ipcMain.handle('lsp:ensureServerForFile', async (_, params: { filePath: string; languageId: LanguageId; workspacePath: string }) => {
    const serverName = await lspManager.ensureServerForFile(params.filePath, params.languageId, params.workspacePath)
    return { success: !!serverName, serverName }
  })

  // ============ 文件监视通知 ============

  ipcMain.handle('lsp:didChangeWatchedFiles', async (_, params: { changes: Array<{ uri: string; type: number }>; workspacePath?: string }) => {
    const running = lspManager.getRunningServers(params.workspacePath)
    for (const serverKey of running) {
      lspManager.notifyDidChangeWatchedFiles(serverKey, params.changes)
    }
  })

  // ============ 获取支持的语言 ============

  ipcMain.handle('lsp:getSupportedLanguages', () => {
    return lspManager.getSupportedLanguages()
  })

  // ============ LSP 服务器安装管理 ============

  ipcMain.handle('lsp:getServerStatus', () => {
    return getLspServerStatus()
  })

  ipcMain.handle('lsp:getBinDir', () => {
    return getLspBinDir()
  })

  ipcMain.handle('lsp:getDefaultBinDir', () => {
    return getDefaultLspBinDir()
  })

  ipcMain.handle('lsp:setCustomBinDir', (_, customPath: string | null) => {
    setCustomLspBinDir(customPath)
    // 保存到配置文件
    if (_preferencesStore) {
      if (customPath) {
        _preferencesStore.set('lspSettings.customBinDir', customPath)
      } else {
        _preferencesStore.delete('lspSettings.customBinDir')
      }
    }
    return { success: true }
  })

  ipcMain.handle('lsp:installServer', async (_, serverType: string) => {
    try {
      const result = await installServer(serverType)
      if (result.success) {
        // 清除 unavailable 冷却标记，允许立即重试启动
        lspManager.clearUnavailable(serverType)
      }
      return result
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  ipcMain.handle('lsp:installBasicServers', async () => {
    try {
      const result = await installBasicServers()
      if (result.success) {
        lspManager.clearUnavailable('typescript')
        lspManager.clearUnavailable('html')
        lspManager.clearUnavailable('css')
        lspManager.clearUnavailable('json')
      }
      return result
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // ============ 语言环境配置 ============

  ipcMain.handle('lsp:getLanguageEnv', (_, params: { workspacePath: string; languageId: string }) => {
    return getLanguageEnv(params.workspacePath, params.languageId)
  })

  ipcMain.handle('lsp:setLanguageEnv', async (_, params: { workspacePath: string; languageId: string; runtimePath: string; extraPaths?: string[] }) => {
    setLanguageEnv(params.workspacePath, params.languageId, {
      runtimePath: params.runtimePath,
      extraPaths: params.extraPaths,
    })

    // 清除缓存并重启对应的 LSP 服务器以应用新配置
    const { invalidatePythonPathCache } = await import('../lsp/lspManager')
    invalidatePythonPathCache(params.workspacePath)

    // 重启该语言的 LSP 服务器
    const serverName = lspManager.getServerForLanguage(params.languageId as LanguageId)
    if (serverName) {
      const running = lspManager.getRunningServers()
      const matchingKey = running.find(k => k.startsWith(serverName + ':'))
      if (matchingKey) {
        await lspManager.stopServerByKey(matchingKey)
        await lspManager.startServer(serverName, params.workspacePath)
      }
    }

    return { success: true }
  })

  ipcMain.handle('lsp:removeLanguageEnv', async (_, params: { workspacePath: string; languageId: string }) => {
    removeLanguageEnv(params.workspacePath, params.languageId)

    const { invalidatePythonPathCache } = await import('../lsp/lspManager')
    invalidatePythonPathCache(params.workspacePath)

    return { success: true }
  })

  ipcMain.handle('lsp:getAllLanguageEnv', (_, params: { workspacePath: string }) => {
    return getAllLanguageEnv(params.workspacePath)
  })

  ipcMain.handle('lsp:resolveRuntimePath', (_, params: { workspacePath: string; languageId: string }) => {
    return resolveRuntimePath(params.workspacePath, params.languageId)
  })

  logger.lsp.info('[LSP IPC] Handlers registered')
}
