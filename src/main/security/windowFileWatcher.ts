import * as path from 'path'
import { logger } from '@shared/utils/Logger'
import { resolveGitMetadataDirectory } from '../services/gitMetadata'
import { cleanupFileWatcher, setupFileWatcher, type FileWatcherEvent } from './fileWatcher'

interface WindowWatchState {
  revision: number
  stopped: boolean
  queue: Promise<void>
  watchers: Set<string>
  pending: Map<string, FileWatcherEvent>
  timer?: ReturnType<typeof setTimeout>
}

const windows = new Map<number, WindowWatchState>()

function rootKey(root: string): string {
  const resolved = path.resolve(root)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function clearPending(state: WindowWatchState): void {
  clearTimeout(state.timer)
  state.timer = undefined
  state.pending.clear()
}

/** One subscription per window/root; native watchers remain shared across windows. */
export function setWindowFileWatchers(sender: Electron.WebContents, roots: string[]): Promise<void> {
  let state = windows.get(sender.id)
  if (!state) {
    state = { revision: 0, stopped: false, queue: Promise.resolve(), watchers: new Set(), pending: new Map() }
    windows.set(sender.id, state)
  }
  const current = state
  const revision = ++current.revision
  current.stopped = false
  clearPending(current)

  const forward = (event: FileWatcherEvent) => {
    if (current.stopped || sender.isDestroyed()) return
    current.pending.set(event.path, event)
    if (current.timer) return
    const flush = () => {
      current.timer = undefined
      if (current.stopped || sender.isDestroyed()) {
        clearPending(current)
        return
      }
      let count = 0
      for (const [filePath, item] of current.pending) {
        current.pending.delete(filePath)
        try { sender.send('file:changed', item) } catch { void cleanupWindowFileWatchers(sender.id); return }
        if (++count >= 128) break
      }
      if (current.pending.size) current.timer = setTimeout(flush, 0)
    }
    current.timer = setTimeout(flush, 33)
  }

  // Serialize transitions, including stop/start during an in-flight native subscribe.
  current.queue = current.queue.then(async () => {
    if (current.revision !== revision || sender.isDestroyed()) return
    const desired = new Map<string, { root: string; git: boolean }>()
    const uniqueRoots = new Map(roots.map(root => [rootKey(root), path.resolve(root)]))
    for (const [key, root] of uniqueRoots) {
      desired.set(`window-${sender.id}:root:${key}`, { root, git: false })
      const gitDirectory = await resolveGitMetadataDirectory(root)
      const relative = gitDirectory ? path.relative(root, gitDirectory) : ''
      if (gitDirectory && (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))) {
        desired.set(`window-${sender.id}:git:${rootKey(gitDirectory)}`, { root: gitDirectory, git: true })
      }
    }
    if (current.revision !== revision || sender.isDestroyed()) return

    for (const id of current.watchers) {
      if (!desired.has(id)) {
        await cleanupFileWatcher(id)
        current.watchers.delete(id)
      }
    }
    for (const [id, { root, git }] of desired) {
      if (current.revision !== revision || sender.isDestroyed()) return
      if (current.watchers.has(id)) continue
      try {
        await setupFileWatcher(id, root, git ? event => forward({ ...event, source: 'git-metadata' }) : forward,
          git ? { forwardOnly: true } : undefined)
        current.watchers.add(id)
      } catch (error) {
        logger.security.warn('[Workspace] File watching is unavailable; workspace remains open', { root, error })
      }
    }
  }).catch(error => {
    logger.security.warn('[Workspace] Failed to update file watchers', error)
  })
  return current.queue
}

export async function cleanupWindowFileWatchers(webContentsId?: number): Promise<void> {
  if (webContentsId === undefined) {
    await Promise.all([...windows.keys()].map(id => cleanupWindowFileWatchers(id)))
    return
  }
  const state = windows.get(webContentsId)
  if (!state) return
  const revision = ++state.revision
  state.stopped = true
  clearPending(state)
  state.queue = state.queue.then(async () => {
    if (state.revision !== revision) return
    for (const id of state.watchers) await cleanupFileWatcher(id)
    state.watchers.clear()
    if (state.revision === revision) windows.delete(webContentsId)
  })
  return state.queue
}
