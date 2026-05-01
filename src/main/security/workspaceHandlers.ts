import { logger } from '@shared/utils/Logger'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { promises as fsPromises } from 'fs'
import * as path from 'path'
import { getWorkspaceConfigFilePath } from '../services/configPath'
import { cleanupFileWatcher, setupFileWatcher, type FileWatcherEvent } from './fileWatcher'
import { securityManager } from './securityModule'

export interface WindowManagerContext {
  findWindowByWorkspace?: (roots: string[]) => BrowserWindow | null
  setWindowWorkspace?: (windowId: number, roots: string[]) => void
}

const WORKSPACE_MARKER_RELATIVE_PATH = path.join('.adnify', 'workspace-meta.json')
const WORKSPACE_DESCRIPTOR_FILENAME = 'workspace.json'

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

async function restartWindowFileWatcher(sender: Electron.WebContents, roots: string[]): Promise<void> {
  const watcherId = getWatcherId(sender.id)
  if (!roots.length) {
    await cleanupFileWatcher(watcherId)
    return
  }

  await setupFileWatcher(watcherId, roots[0], (data: FileWatcherEvent) => {
    try {
      sender.send('file:changed', data)
    } catch {
      void cleanupFileWatcher(watcherId)
    }
  })
}

async function readWorkspaceMarkerId(root: string): Promise<string | null> {
  try {
    const markerPath = path.join(root, WORKSPACE_MARKER_RELATIVE_PATH)
    const content = await fsPromises.readFile(markerPath, 'utf-8')
    const parsed = JSON.parse(content) as { id?: string }
    return typeof parsed.id === 'string' && parsed.id.trim() ? parsed.id : null
  } catch {
    try {
      const legacyMarkerPath = path.join(root, '.adnify', 'workspace.json')
      const content = await fsPromises.readFile(legacyMarkerPath, 'utf-8')
      const parsed = JSON.parse(content) as { id?: string }
      return typeof parsed.id === 'string' && parsed.id.trim() ? parsed.id : null
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

  await fsPromises.mkdir(markerDir, { recursive: true })
  await fsPromises.writeFile(markerPath, JSON.stringify({
    id: workspaceId,
    createdAt: new Date().toISOString(),
    version: 1,
  }, null, 2), 'utf-8')

  return workspaceId
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
    if (windowManager?.findWindowByWorkspace) {
      const existingWindow = windowManager.findWindowByWorkspace([folderPath])
      if (existingWindow && existingWindow !== mainWindow) {
        if (existingWindow.isMinimized()) existingWindow.restore()
        existingWindow.focus()
        return { redirected: true, path: folderPath }
      }
    }

    const workspaceId = await ensureWorkspaceMarker(folderPath)
    windowManager?.setWindowWorkspace?.(event.sender.id, [folderPath])
    securityManager.setWorkspacePath(folderPath)
    persistWorkspaceSession({ configPath: null, roots: [folderPath], workspaceId: workspaceId || undefined })
    addRecentWorkspace(folderPath)
    await restartWindowFileWatcher(event.sender, [folderPath])
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

    if (windowManager?.findWindowByWorkspace && roots.length > 0) {
      const existingWindow = windowManager.findWindowByWorkspace(roots)
      if (existingWindow && existingWindow !== mainWindow) {
        if (existingWindow.isMinimized()) existingWindow.restore()
        existingWindow.focus()
        return { redirected: true, roots }
      }
    }

    const workspaceId = roots[0] ? await ensureWorkspaceMarker(roots[0]) : null
    windowManager?.setWindowWorkspace?.(event.sender.id, roots)
    securityManager.setWorkspacePath(roots[0] || null)
    const session: StoredWorkspaceSession = { configPath: descriptorPath, roots, workspaceId: workspaceId || undefined }
    persistWorkspaceSession(session)
    roots.forEach(addRecentWorkspace)
    await restartWindowFileWatcher(event.sender, roots)
    return session
  })

  ipcMain.handle('workspace:addFolder', async () => {
    const mainWindow = getMainWindowFn()
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0] || null
  })

  ipcMain.handle('workspace:save', async (_, configPath: string | null, roots: string[]) => {
    if (!roots.length) return false
    try {
      await writeWorkspaceDescriptor(configPath || getWorkspaceDescriptorPath(roots[0]), roots)
      return true
    } catch (error) {
      logger.security.error('Failed to save workspace', error)
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

  ipcMain.handle('workspace:setActive', async (event, roots: string[]) => {
    if (!roots.length) return false

    const mainWindow = getMainWindowFn()
    if (windowManager?.findWindowByWorkspace) {
      const existingWindow = windowManager.findWindowByWorkspace(roots)
      if (existingWindow && existingWindow !== mainWindow) {
        if (existingWindow.isMinimized()) existingWindow.restore()
        existingWindow.focus()
        return { redirected: true, roots }
      }
    }

    const workspaceId = roots[0] ? await ensureWorkspaceMarker(roots[0]) : null
    windowManager?.setWindowWorkspace?.(event.sender.id, roots)
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
