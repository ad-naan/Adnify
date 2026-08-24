import { app, BrowserWindow, dialog } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/utils/Logger'
import { authorizeUserFile } from '../security/userFileAccess'

const OPEN_FILES_CHANNEL = 'app:open-files'
export interface OpenFilesPayload {
  items: Array<{ path: string; kind: 'file' | 'folder' | 'workspace'; roots?: string[] }>
  source: 'startup' | 'second-instance' | 'open-file'
}

type WindowResolver = () => BrowserWindow | null

const pendingItems = new Map<string, OpenFilesPayload['items'][number]>()

function resolveLaunchPath(candidate: string): string {
  const trimmed = candidate.trim()
  if (path.isAbsolute(trimmed)) {
    return path.normalize(trimmed)
  }

  const cwdResolved = path.resolve(process.cwd(), trimmed)
  if (fs.existsSync(cwdResolved)) {
    return path.normalize(cwdResolved)
  }

  return path.normalize(path.resolve(app.getAppPath(), trimmed))
}

function normalizeForCompare(candidate: string): string {
  return path.normalize(candidate).replace(/[\\/]+$/, '').toLowerCase()
}

function isInternalLaunchArg(filePath: string): boolean {
  const resolved = normalizeForCompare(filePath)
  const internalPaths = [process.execPath]

  try {
    internalPaths.push(app.getPath('exe'))
  } catch {
    // app.getPath('exe') is best-effort during very early startup.
  }

  try {
    internalPaths.push(app.getAppPath())
  } catch {
    // Ignore; missing app path should not block opening user-provided files.
  }

  return internalPaths
    .filter(Boolean)
    .some(internalPath => resolved === normalizeForCompare(internalPath))
}

function readWorkspaceRoots(filePath: string): string[] | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(content) as { folders?: Array<{ path?: string }> }
    const roots = (parsed.folders || [])
      .map(folder => folder.path?.trim())
      .filter((value): value is string => Boolean(value))
      .map(root => path.isAbsolute(root) ? root : path.resolve(path.dirname(filePath), root))
    return roots.length > 0 ? roots : null
  } catch {
    return null
  }
}

function readWorkspaceDescriptorFromRoot(root: string): string[] | null {
  const descriptorPath = path.join(root, '.adnify', 'workspace.json')
  if (!fs.existsSync(descriptorPath)) {
    return null
  }

  return readWorkspaceRoots(descriptorPath)
}

function normalizeCandidate(filePath: string): OpenFilesPayload['items'][number] | null {
  if (!filePath) return null
  const trimmed = filePath.trim()
  if (!trimmed || trimmed.startsWith('-')) return null

  try {
    const resolved = resolveLaunchPath(trimmed)
    if (isInternalLaunchArg(resolved)) {
      return null
    }

    if (!fs.existsSync(resolved)) {
      return null
    }
    const stats = fs.statSync(resolved)
    if (stats.isDirectory()) {
      const roots = readWorkspaceDescriptorFromRoot(resolved)
      return roots?.length
        ? { path: resolved, kind: 'workspace', roots }
        : { path: resolved, kind: 'folder' }
    }

    return { path: resolved, kind: 'file' }
  } catch {
    return null
  }
}

function extractFilePaths(argv: string[]): OpenFilesPayload['items'] {
  return argv
    .map(normalizeCandidate)
    .filter((value): value is OpenFilesPayload['items'][number] => Boolean(value))
}

function pushPaths(items: OpenFilesPayload['items']): void {
  for (const item of items) {
    pendingItems.set(item.path.toLowerCase(), item)
    // 将用户主动打开的文件路径加入授权集合
    if (item.kind === 'file') {
      authorizeUserFile(item.path, 'file-association', 'write')
    }
  }
}

export function collectLaunchFiles(argv: string[]): OpenFilesPayload['items'] {
  return extractFilePaths(argv)
}

export function queueLaunchFiles(items: OpenFilesPayload['items'], source: OpenFilesPayload['source']): void {
  if (items.length === 0) return
  logger.system.info('[Files] Queued launch items', { source, count: items.length })
  pushPaths(items)
}

export function flushLaunchFiles(getWindow: WindowResolver, source: OpenFilesPayload['source'] = 'startup'): boolean {
  const win = getWindow()
  if (!win || win.isDestroyed() || pendingItems.size === 0) {
    return false
  }

  const items = [...pendingItems.values()]
  pendingItems.clear()
  win.webContents.send(OPEN_FILES_CHANNEL, { items, source } satisfies OpenFilesPayload)
  logger.system.info('[Files] Dispatched launch items', { source, count: items.length, windowId: win.id })
  return true
}

export function flushLaunchFilesToWindow(win: BrowserWindow, source: OpenFilesPayload['source'] = 'startup'): boolean {
  return flushLaunchFiles(() => win, source)
}

export function getOpenFilesChannel(): string {
  return OPEN_FILES_CHANNEL
}

export async function pickLaunchTarget(win: BrowserWindow): Promise<OpenFilesPayload['items'][number] | null> {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'openDirectory'],
  })

  const targetPath = result.filePaths[0]
  if (!targetPath) {
    return null
  }

  return normalizeCandidate(targetPath)
}
