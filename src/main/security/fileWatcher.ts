/**
 * 文件监听服务
 * 使用 @parcel/watcher 监听文件变化
 */

import { logger } from '@shared/utils/Logger'
import { toAppError } from '@shared/utils/errorHandler'
import { FileChangeBuffer, createFileChangeHandler } from '../indexing/fileChangeBuffer'
import { getIndexService } from '../indexing/indexService'
import { lspManager } from '../lsp/lspManager'
import * as watcher from '@parcel/watcher'
import picomatch from 'picomatch'
import * as path from 'path'

export interface FileWatcherEvent {
  event: 'create' | 'update' | 'delete'
  path: string
  source?: 'git-metadata'
}

export interface FileWatcherConfig {
  ignored: (string | RegExp)[]
  persistent: boolean
  ignoreInitial: boolean
  bufferTimeMs: number
  maxBufferSize: number
  maxWaitTimeMs: number
  forwardOnly: boolean
}

interface WatcherEntry {
  subscription: watcher.AsyncSubscription
  buffer: FileChangeBuffer | null
  root: string
  subscribers: Map<string, (data: FileWatcherEvent) => void>
}

const DEFAULT_CONFIG: FileWatcherConfig = {
  ignored: [/node_modules/, /\.git/, /dist/, /build/, /\.adnify/, '**/*.tmp', '**/*.temp'],
  persistent: true,
  ignoreInitial: true,
  bufferTimeMs: 500,
  maxBufferSize: 50,
  maxWaitTimeMs: 5000,
  forwardOnly: false,
}

const watcherEntries = new Map<string, WatcherEntry>()
const watcherRootsById = new Map<string, string>()
const pendingWatcherEntries = new Map<string, Promise<WatcherEntry>>()

const LSP_FILE_CHANGE_TYPE = {
  create: 1,
  update: 2,
  delete: 3,
} as const

function createIgnoreMatcher(patterns: (string | RegExp)[]): (path: string) => boolean {
  const regexPatterns = patterns.filter((p): p is RegExp => p instanceof RegExp)
  const globPatterns = patterns.filter((p): p is string => typeof p === 'string')
  const globMatcher = globPatterns.length > 0 ? picomatch(globPatterns) : null

  return (filePath: string) => {
    for (const regex of regexPatterns) {
      if (regex.test(filePath)) return true
    }
    if (globMatcher && globMatcher(filePath)) return true
    return false
  }
}

function notifyLspFileChanges(
  workspaceRoot: string,
  changes: Array<{ path: string; type: 'create' | 'update' | 'delete' }>,
): void {
  const runningServers = lspManager.getRunningServers(workspaceRoot)
  if (runningServers.length === 0) return

  const lspChanges = changes.map(c => ({
    uri: pathToLspUri(c.path),
    type: LSP_FILE_CHANGE_TYPE[c.type],
  }))

  for (const serverKey of runningServers) {
    lspManager.notifyDidChangeWatchedFiles(serverKey, lspChanges)
  }
}

function pathToLspUri(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/')
  if (/^[a-zA-Z]:/.test(normalizedPath)) {
    return `file:///${normalizedPath}`
  }
  return `file://${normalizedPath}`
}

function getBackend(): watcher.BackendType | undefined {
  switch (process.platform) {
    case 'win32':
      return 'windows'
    case 'darwin':
      return 'fs-events'
    case 'linux':
      return 'inotify'
    default:
      return undefined
  }
}

function getRootKey(workspaceRoot: string): string {
  const normalized = path.resolve(workspaceRoot).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

async function createWatcherEntry(
  workspaceRoot: string,
  config?: Partial<FileWatcherConfig>,
): Promise<WatcherEntry> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config }
  const shouldIgnore = createIgnoreMatcher(mergedConfig.ignored)
  const fileChangeBuffer = mergedConfig.forwardOnly
    ? null
    : createFileChangeHandler(getIndexService(workspaceRoot), {
        bufferTimeMs: mergedConfig.bufferTimeMs,
        maxBufferSize: mergedConfig.maxBufferSize,
        maxWaitTimeMs: mergedConfig.maxWaitTimeMs,
      })
  const subscribers = new Map<string, (data: FileWatcherEvent) => void>()
  const watcherOptions: watcher.Options = {
    ignore: mergedConfig.ignored.filter((p): p is string => typeof p === 'string'),
    backend: getBackend(),
  }

  try {
    const subscription = await watcher.subscribe(workspaceRoot, (err, events) => {
      if (err) {
        logger.security.error('[Watcher] Error:', err)
        return
      }

      const lspChanges: Array<{ path: string; type: 'create' | 'update' | 'delete' }> = []
      for (const event of events) {
        const normalizedEventPath = event.path.replace(/\\/g, '/')
        const gitMarker = normalizedEventPath.match(/(?:^|\/)\.git(?:\/|$)/)
        const isGitMetadata = gitMarker !== null
        const gitRelativePath = gitMarker?.index !== undefined
          ? normalizedEventPath.slice(gitMarker.index + gitMarker[0].length)
          : ''
        const isGitStateSignal = isGitMetadata && (
          gitRelativePath === ''
          || /^(?:HEAD|index|packed-refs|FETCH_HEAD|ORIG_HEAD|MERGE_HEAD|CHERRY_PICK_HEAD|REVERT_HEAD)$/.test(gitRelativePath)
          || /^(?:refs|rebase-merge|rebase-apply)\//.test(gitRelativePath)
        )
        if (shouldIgnore(event.path) && !isGitStateSignal) continue

        const eventType = event.type === 'create' ? 'create' : event.type === 'delete' ? 'delete' : 'update'
        const data = { event: eventType, path: event.path } as FileWatcherEvent
        for (const callback of subscribers.values()) {
          try { callback(data) } catch { /* one window must not break the shared watcher */ }
        }

        // Git metadata drives branch/status UI updates, but must never be indexed
        // or forwarded to language servers.
        if (isGitMetadata) continue

        fileChangeBuffer?.add({ type: eventType, path: event.path, timestamp: Date.now() })
        lspChanges.push({ path: event.path, type: eventType })
      }

      if (lspChanges.length > 0) notifyLspFileChanges(workspaceRoot, lspChanges)
    }, watcherOptions)

    return { subscription, buffer: fileChangeBuffer, root: workspaceRoot, subscribers }
  } catch (error) {
    fileChangeBuffer?.destroy()
    throw error
  }
}

export async function setupFileWatcher(
  watcherId: string,
  workspaceRoot: string,
  callback: (data: FileWatcherEvent) => void,
  config?: Partial<FileWatcherConfig>
): Promise<void> {
  if (!watcherId || !workspaceRoot) return

  await cleanupFileWatcher(watcherId)
  const rootKey = getRootKey(workspaceRoot)
  let entry = watcherEntries.get(rootKey)
  if (!entry) {
    let pending = pendingWatcherEntries.get(rootKey)
    if (!pending) {
      pending = createWatcherEntry(workspaceRoot, config)
      pendingWatcherEntries.set(rootKey, pending)
    }
    try {
      entry = await pending
      watcherEntries.set(rootKey, entry)
    } finally {
      pendingWatcherEntries.delete(rootKey)
    }
  }

  entry.subscribers.set(watcherId, callback)
  watcherRootsById.set(watcherId, rootKey)
  logger.security.info('[Watcher] File watcher subscribed:', workspaceRoot, 'id:', watcherId, 'subscribers:', entry.subscribers.size)
}

export async function cleanupFileWatcher(watcherId?: string): Promise<void> {
  if (watcherId) {
    const rootKey = watcherRootsById.get(watcherId)
    if (!rootKey) return

    watcherRootsById.delete(watcherId)
    const entry = watcherEntries.get(rootKey)
    entry?.subscribers.delete(watcherId)
    if (!entry || entry.subscribers.size > 0) return

    watcherEntries.delete(rootKey)
    entry.buffer?.destroy()
    logger.security.info('[Watcher] Cleaning up shared file watcher...', 'root:', entry.root)
    try {
      await entry.subscription.unsubscribe()
    } catch (err) {
      logger.security.info('[Watcher] Cleanup completed (ignored error):', toAppError(err).message)
    }
    return
  }

  watcherRootsById.clear()
  const entries = Array.from(watcherEntries.values())
  watcherEntries.clear()
  await Promise.all(entries.map(async (entry) => {
    entry.buffer?.destroy()
    try {
      await entry.subscription.unsubscribe()
    } catch (err) {
      logger.security.info('[Watcher] Cleanup completed (ignored error):', toAppError(err).message)
    }
  }))
}

export function getWatcherStatus(): {
  isActive: boolean
  hasBuffer: boolean
  bufferSize: number
} {
  const entries = Array.from(watcherEntries.values())

  return {
    isActive: entries.length > 0,
    hasBuffer: entries.some(entry => entry.buffer !== null),
    bufferSize: entries.reduce((sum, entry) => sum + (entry.buffer?.size() || 0), 0),
  }
}

export function flushBuffer(watcherId?: string): void {
  if (watcherId) {
    const rootKey = watcherRootsById.get(watcherId)
    if (rootKey) watcherEntries.get(rootKey)?.buffer?.flush()
    return
  }

  watcherEntries.forEach(entry => entry.buffer?.flush())
}
