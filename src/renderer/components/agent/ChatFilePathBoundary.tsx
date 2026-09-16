import React, { useCallback } from 'react'
import { FolderOpen } from 'lucide-react'
import { useStore } from '@store'
import { api } from '@renderer/services/electronAPI'
import { isBinaryFile, safeOpenFile } from '@renderer/utils/fileUtils'
import { t } from '@shared/i18n'
import { getDirname, normalizePath } from '@shared/utils/pathUtils'
import { toast } from '../common/ToastProvider'
import { ContextMenu, useContextMenu } from '../ui/ContextMenu'
import { parseChatFilePath, resolveChatFilePath } from './chatFilePaths'

const FILE_LOOKUP_IGNORES = new Set(['node_modules', 'dist', 'build', 'coverage', 'release', 'test-results'])
const MAX_LOOKUP_DIRECTORIES = 2_000
const LOOKUP_BATCH_SIZE = 12

async function findUniqueWorkspaceFile(value: string, workspacePath: string): Promise<string | null> {
  const relativePath = parseChatFilePath(value)
  if (!relativePath || /^(?:\/|[a-z]:\/|\/\/)/i.test(relativePath) || relativePath.endsWith('/')) return null

  const normalizedSuffix = relativePath.toLowerCase().replace(/^\.\//, '')
  const isBasenameOnly = !normalizedSuffix.includes('/')
  const directories = [workspacePath]
  const matches: string[] = []
  let visitedDirectories = 0

  while (directories.length > 0 && matches.length < 2 && visitedDirectories < MAX_LOOKUP_DIRECTORIES) {
    const batch = directories.splice(0, LOOKUP_BATCH_SIZE)
    visitedDirectories += batch.length
    const listings = await Promise.all(batch.map(directory => api.file.readDir(directory)))

    for (const items of listings) {
      for (const item of items || []) {
        if (item.isDirectory) {
          if (!item.name.startsWith('.') && !FILE_LOOKUP_IGNORES.has(item.name)) directories.push(item.path)
          continue
        }
        const normalizedCandidate = normalizePath(item.path).toLowerCase()
        const matchesPath = isBasenameOnly
          ? item.name.toLowerCase() === normalizedSuffix
          : normalizedCandidate.endsWith(`/${normalizedSuffix}`)
        if (matchesPath) matches.push(normalizePath(item.path))
        if (matches.length >= 2) break
      }
      if (matches.length >= 2) break
    }
  }

  return matches.length === 1 ? matches[0] : null
}

async function resolveExistingChatFilePath(value: string, workspacePath: string | null): Promise<{
  path: string
  stat: { isDirectory: boolean } | null
} | null> {
  const directPath = resolveChatFilePath(value, workspacePath)
  if (!directPath) return null

  const directStat = await api.file.stat(directPath)
  if (directStat) return { path: directPath, stat: directStat }
  if (!workspacePath) return { path: directPath, stat: null }

  const matchedPath = await findUniqueWorkspaceFile(value, workspacePath)
  return matchedPath ? { path: matchedPath, stat: { isDirectory: false } } : { path: directPath, stat: null }
}

async function revealChatFilePath(path: string): Promise<boolean> {
  if (await api.file.showInFolder(path)) return true

  // The model can mention a file that has just been moved or deleted. Opening
  // its existing parent is still useful and makes "Open Containing Folder"
  // behave according to its label instead of failing with the file lookup.
  const parentPath = getDirname(path)
  if (!parentPath || parentPath === path) return false
  const parentStat = await api.file.stat(parentPath)
  return Boolean(parentStat?.isDirectory && await api.file.openWithDefault(parentPath))
}

export async function activateChatFilePath(value: string, reveal = false): Promise<void> {
  const { workspacePath, language } = useStore.getState()
  let path = resolveChatFilePath(value, workspacePath)
  try {
    const resolved = await resolveExistingChatFilePath(value, workspacePath)
    if (!resolved) throw new Error('Unresolved path')
    path = resolved.path
    if (reveal) {
      if (!await revealChatFilePath(path)) throw new Error('Cannot reveal file')
    } else if (isBinaryFile(path)) {
      if (!await api.file.openWithDefault(path)) throw new Error('Cannot open file')
    } else {
      if (!resolved.stat) throw new Error('File not found')
      if (resolved.stat.isDirectory) {
        if (!await api.file.openWithDefault(path)) throw new Error('Cannot open directory')
      } else {
        await safeOpenFile(path, { language })
      }
    }
  } catch {
    toast.error(t('chat.filePathOpenFailed', language), path || value)
  }
}

function targetPath(event: React.SyntheticEvent<HTMLElement>): string | null {
  const target = event.target as HTMLElement
  if (target.closest('a')) return null
  const element = target.closest<HTMLElement>('[data-chat-file-link]') || target.closest<HTMLElement>('[data-chat-file-path]')
  return element && event.currentTarget.contains(element) ? element.dataset.chatFilePath || null : null
}

/** One set of delegated handlers and one on-demand menu per message body.
 * No per-path effects, subscriptions, stat calls, or document mousemove listeners.
 */
export function ChatFilePathBoundary({ children }: { children: React.ReactNode }) {
  const { menu, show, hide } = useContextMenu<string>()
  const language = useStore(s => s.language)
  const onClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (!event.ctrlKey && !event.metaKey)) return
    const path = targetPath(event)
    if (!path) return
    event.preventDefault()
    event.stopPropagation()
    void activateChatFilePath(path)
  }, [])
  const onContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const path = targetPath(event)
    if (path) show(event, path)
  }, [show])
  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter') return
    const path = targetPath(event)
    if (!path) return
    event.preventDefault()
    event.stopPropagation()
    void activateChatFilePath(path)
  }, [])
  return (
    <div onClick={onClick} onContextMenu={onContextMenu} onKeyDown={onKeyDown}>
      {children}
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={hide} items={[{
        id: 'reveal-file',
        label: t('chat.openContainingFolder', language),
        icon: FolderOpen,
        onClick: () => { if (menu.data) void activateChatFilePath(menu.data, true) },
      }]} />}
    </div>
  )
}
