import { logger } from '@shared/utils/Logger'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { promises as fsPromises } from 'fs'
import * as path from 'path'
import { getWorkspaceConfigFilePath } from '../services/configPath'
import { cleanupFileWatcher, setupFileWatcher, type FileWatcherEvent } from './fileWatcher'
import { securityManager } from './securityModule'
import { resolveGitMetadataDirectory } from '../services/gitMetadata'
import { systemPrivilegeService } from '../services/systemPrivilegeService'
import { isSystemPermissionError } from '@shared/utils/permissionError'

export interface WindowManagerContext {
  findWindowByWorkspace?: (roots: string[]) => BrowserWindow | null
  setWindowWorkspace?: (windowId: number, roots: string[]) => void
}

const WORKSPACE_MARKER_RELATIVE_PATH = path.join('.adnify', 'workspace-meta.json')
const WORKSPACE_DESCRIPTOR_FILENAME = 'workspace.json'
const WORKSPACE_TRANSITION_GRACE_MS = 10_000
const workspaceTransitionTokens = new Map<number, symbol>()

interface StoredWorkspaceSession {
  configPath: string | null
  roots: string[]
  workspaceId?: string
}

function normalizeWorkspacePath(targetPath: string): string {
  const trimmed = targetPath.trim()
  if (!trimmed) return trimmed
  const normalized = path.normalize(trimmed)
  if (/^[a-zA-Z]:\\$/.test(normalized)) return normalized
  return normalized.replace(/[\\/]+$/, '')
}

function normalizeWorkspacePathForCompare(targetPath: string): string {
  return normalizeWorkspacePath(targetPath).toLowerCase()
}

function isInternalPackagedWorkspaceRoot(root: string): boolean {
  if (!app.isPackaged) return false

  try {
    const exeDir = path.dirname(app.getPath('exe'))
    return normalizeWorkspacePathForCompare(root) === normalizeWorkspacePathForCompare(exeDir)
  } catch {
    return false
  }
}

function getWorkspaceDescriptorPath(workspaceRoot: string): string {
  return getWorkspaceConfigFilePath(workspaceRoot, WORKSPACE_DESCRIPTOR_FILENAME)
}

function parseWorkspaceDescriptor(content: string, descriptorPath: string): string[] {
  const parsed = JSON.parse(content) as { folders?: Array<{ path?: string }> }
  return (parsed.folders || [])
    .map(folder => folder.path?.trim())
    .filter((value): value is string => Boolean(value))
    .map(root => path.isAbsolute(root) ? root : path.resolve(path.dirname(descriptorPath), root))
}

function getWatcherId(webContentsId: number): string {
  return `window-${webContentsId}`
}

function getGitWatcherId(webContentsId: number): string {
  return `window-${webContentsId}-git`
}

async function restartWindowFileWatcher(sender: Electron.WebContents, roots: string[]): Promise<void> {
  const watcherId = getWatcherId(sender.id)
  const gitWatcherId = getGitWatcherId(sender.id)
  await cleanupFileWatcher(gitWatcherId)
  if (!roots.length) {
    await cleanupFileWatcher(watcherId)
    return
  }

  try {
    await setupFileWatcher(watcherId, roots[0], (data: FileWatcherEvent) => {
      try {
        sender.send('file:changed', data)
      } catch {
        void cleanupFileWatcher(watcherId)
        void cleanupFileWatcher(gitWatcherId)
      }
    })
  } catch (error) {
    logger.security.warn('[Workspace] File watching is unavailable; workspace remains open', {
      root: roots[0],
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const gitDirectory = await resolveGitMetadataDirectory(roots[0])
  const workspaceRoot = path.resolve(roots[0])
  const gitRelativePath = gitDirectory ? path.relative(workspaceRoot, gitDirectory) : ''
  const gitDirectoryIsInsideWorkspace = Boolean(gitDirectory) && (
    gitRelativePath === '' || (!gitRelativePath.startsWith('..') && !path.isAbsolute(gitRelativePath))
  )
  if (gitDirectory && !gitDirectoryIsInsideWorkspace) {
    try {
      await setupFileWatcher(gitWatcherId, gitDirectory, (data: FileWatcherEvent) => {
        try {
          sender.send('file:changed', { ...data, source: 'git-metadata' satisfies FileWatcherEvent['source'] })
        } catch {
          void cleanupFileWatcher(gitWatcherId)
        }
      }, { forwardOnly: true })
    } catch (error) {
      logger.security.warn('[Git] Metadata watching is unavailable; focus refresh remains active', {
        gitDirectory,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/**
 * 工作区标记 id 会被直接拼进文件名（`<id>.sqlite3`，见 ipc/sessionStorage.ts），
 * 而这个 id 来自被打开仓库里的 `.adnify/workspace-meta.json` —— 也就是仓库内容，
 * 不是我们自己生成的值。不做字符集校验的话，一个提交了
 * `{"id":"../../../../Users/Public/pwn"}` 的仓库就能让我们在
 * session-storage 目录之外创建目录和文件。
 *
 * ensureWorkspaceMarker 生成的是 `ws_<时间戳>_<base36>`，本来就在这个字符集里，
 * 所以收紧不影响任何正常工作区；不合法的标记按「没有标记」处理，
 * 随后会被重新生成一个合法 id。
 */
const WORKSPACE_MARKER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

function normalizeWorkspaceMarkerId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!WORKSPACE_MARKER_ID_PATTERN.test(trimmed)) {
    if (trimmed) {
      logger.security.warn('[Workspace] Ignoring workspace marker id with unsupported characters')
    }
    return null
  }
  return trimmed
}

export async function readWorkspaceMarkerId(root: string): Promise<string | null> {
  try {
    const markerPath = path.join(root, WORKSPACE_MARKER_RELATIVE_PATH)
    const content = await fsPromises.readFile(markerPath, 'utf-8')
    return normalizeWorkspaceMarkerId((JSON.parse(content) as { id?: unknown }).id)
  } catch {
    try {
      const legacyMarkerPath = path.join(root, '.adnify', 'workspace.json')
      const content = await fsPromises.readFile(legacyMarkerPath, 'utf-8')
      return normalizeWorkspaceMarkerId((JSON.parse(content) as { id?: unknown }).id)
    } catch {
      return null
    }
  }
}

async function ensureWorkspaceMarker(root: string): Promise<string | null> {
  try {
    await fsPromises.access(root)
  } catch {
    return null
  }

  const existingId = await readWorkspaceMarkerId(root)
  if (existingId) return existingId

  const markerPath = path.join(root, WORKSPACE_MARKER_RELATIVE_PATH)
  const markerDir = path.dirname(markerPath)
  const workspaceId = `ws_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

  try {
    await fsPromises.mkdir(markerDir, { recursive: true })
    await fsPromises.writeFile(markerPath, JSON.stringify({
      id: workspaceId,
      createdAt: new Date().toISOString(),
      version: 1,
    }, null, 2), 'utf-8')
    return workspaceId
  } catch (error) {
    logger.security.info('[Workspace] Continuing without an in-repository marker', {
      root,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function writeWorkspaceDescriptor(targetPath: string, roots: string[]): Promise<void> {
  const content = JSON.stringify({
    folders: roots.map(root => ({ path: root })),
  }, null, 2)

  await fsPromises.mkdir(path.dirname(targetPath), { recursive: true })
  await fsPromises.writeFile(targetPath, content, 'utf-8')
}

async function isWorkspaceSessionRestorable(session: StoredWorkspaceSession): Promise<boolean> {
  if (!session.roots.length) return false
  if (isInternalPackagedWorkspaceRoot(session.roots[0])) return false

  try {
    await Promise.all(session.roots.map(root => fsPromises.access(root)))
  } catch {
    return false
  }

  const currentWorkspaceId = await readWorkspaceMarkerId(session.roots[0])
  if (!session.workspaceId) {
    return true
  }

  if (!currentWorkspaceId) {
    await ensureWorkspaceMarker(session.roots[0])
    return true
  }

  return currentWorkspaceId === session.workspaceId
}

export function registerWorkspaceHandlers(
  getMainWindowFn: () => BrowserWindow | null,
  store: any,
  _getWorkspaceSessionFn: (event?: Electron.IpcMainInvokeEvent) => { roots: string[] } | null,
  windowManager?: WindowManagerContext
): void {
  function addRecentWorkspace(workspacePath: string): void {
    const normalizedPath = normalizeWorkspacePath(workspacePath)
    const recent = store.get('recentWorkspaces', []) as string[]
    const filtered = recent.filter((item: string) => normalizeWorkspacePath(item).toLowerCase() !== normalizedPath.toLowerCase())
    store.set('recentWorkspaces', [normalizedPath, ...filtered].slice(0, 10))
  }

  function persistWorkspaceSession(session: StoredWorkspaceSession): void {
    if (session.roots.length === 0) return
    store.set('lastWorkspaceSession', session)
    store.set('lastWorkspacePath', session.roots[0])
  }

  ipcMain.handle('file:openFolder', async (event) => {
    const mainWindow = getMainWindowFn()
    if (!mainWindow) return null

    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null

    const folderPath = normalizeWorkspacePath(result.filePaths[0])
    // This handler is a picker only. WorkspaceManager first persists the old
    // workspace, then workspace:setActive performs the security/window switch.
    return folderPath
  })

  ipcMain.handle('workspace:open', async (event) => {
    const mainWindow = getMainWindowFn()
    if (!mainWindow) return null

    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null

    const workspaceRoot = normalizeWorkspacePath(result.filePaths[0])
    const descriptorPath = getWorkspaceDescriptorPath(workspaceRoot)

    let roots: string[]
    try {
      const content = await fsPromises.readFile(descriptorPath, 'utf-8')
      roots = parseWorkspaceDescriptor(content, descriptorPath)
    } catch {
      return null
    }

    // As with file:openFolder, selecting a workspace must not revoke access to
    // the currently-open workspace before its renderer has persisted state.
    return { configPath: descriptorPath, roots }
  })

  ipcMain.handle('workspace:addFolder', async () => {
    const mainWindow = getMainWindowFn()
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0] || null
  })

  ipcMain.handle('workspace:save', async (event, configPath: string | null, roots: string[]) => {
    if (!roots.length) return false
    try {
      await writeWorkspaceDescriptor(configPath || getWorkspaceDescriptorPath(roots[0]), roots)
      return true
    } catch (error) {
      logger.security.error('Failed to save workspace', error)
      if (isSystemPermissionError(error)) {
        systemPrivilegeService.notifyPermissionRequired(event.sender, 'file.writeProtected')
      }
      return false
    }
  })

  ipcMain.handle('workspace:restore', async (event) => {
    const session = store.get('lastWorkspaceSession') as StoredWorkspaceSession | null
    if (!session) return null

    const restorable = await isWorkspaceSessionRestorable(session)
    if (!restorable) {
      store.delete('lastWorkspaceSession')
      store.delete('lastWorkspacePath')
      securityManager.setWorkspacePath(null)
      return { configPath: null, roots: [], restoreError: 'missing-workspace', missingRoots: session.roots }
    }

    windowManager?.setWindowWorkspace?.(event.sender.id, session.roots)
    securityManager.setWorkspacePath(session.roots[0] || null)
    await restartWindowFileWatcher(event.sender, session.roots)
    return session
  })

  ipcMain.handle('workspace:setActive', async (
    event,
    roots: string[],
    options?: { retainRootsDuringTransition?: string[] },
  ) => {
    if (!roots.length) return false

    const mainWindow = BrowserWindow.fromWebContents(event.sender) || getMainWindowFn()
    if (windowManager?.findWindowByWorkspace) {
      const existingWindow = windowManager.findWindowByWorkspace(roots)
      if (existingWindow && existingWindow !== mainWindow) {
        if (existingWindow.isMinimized()) existingWindow.restore()
        existingWindow.focus()
        return { redirected: true, roots }
      }
    }

    const workspaceId = roots[0] ? await ensureWorkspaceMarker(roots[0]) : null
    const retainedRoots = (options?.retainRootsDuringTransition || [])
      .filter(root => typeof root === 'string' && root.trim().length > 0)
    const transitionRoots = Array.from(new Set([...roots, ...retainedRoots]))
    const transitionToken = Symbol('workspace-transition')
    workspaceTransitionTokens.set(event.sender.id, transitionToken)
    windowManager?.setWindowWorkspace?.(event.sender.id, transitionRoots)
    if (retainedRoots.length > 0) {
      setTimeout(() => {
        if (workspaceTransitionTokens.get(event.sender.id) !== transitionToken) return
        if (event.sender.isDestroyed()) {
          workspaceTransitionTokens.delete(event.sender.id)
          return
        }
        windowManager?.setWindowWorkspace?.(event.sender.id, roots)
        workspaceTransitionTokens.delete(event.sender.id)
      }, WORKSPACE_TRANSITION_GRACE_MS)
    } else {
      workspaceTransitionTokens.delete(event.sender.id)
    }
    securityManager.setWorkspacePath(roots[0] || null)
    persistWorkspaceSession({ configPath: null, roots, workspaceId: workspaceId || undefined })
    roots.forEach(addRecentWorkspace)
    await restartWindowFileWatcher(event.sender, roots)
    return true
  })

  ipcMain.handle('workspace:getRecent', () => {
    const recent = store.get('recentWorkspaces', []) as string[]
    const normalized = recent.map(item => normalizeWorkspacePath(item)).filter(Boolean)
    if (normalized.length !== recent.length || normalized.some((item, index) => item !== recent[index])) {
      store.set('recentWorkspaces', normalized)
    }
    return normalized
  })

  ipcMain.handle('workspace:exists', async (_, targetPath: string) => {
    if (!targetPath) return false
    try {
      return (await fsPromises.stat(targetPath)).isDirectory()
    } catch {
      return false
    }
  })

  ipcMain.handle('workspace:clearRecent', () => {
    store.set('recentWorkspaces', [])
    return true
  })

  ipcMain.handle('workspace:removeFromRecent', (_, targetPath: string) => {
    if (!targetPath) return false
    const normalizedTarget = normalizeWorkspacePath(targetPath)
    const recent = store.get('recentWorkspaces', []) as string[]
    store.set('recentWorkspaces', recent.filter((item: string) => normalizeWorkspacePath(item).toLowerCase() !== normalizedTarget.toLowerCase()))
    return true
  })

  ipcMain.handle('dialog:selectFolder', async () => {
    const mainWindow = getMainWindowFn()
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0] || null
  })
}
