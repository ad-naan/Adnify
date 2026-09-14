import React, { useCallback } from 'react'
import { FolderOpen } from 'lucide-react'
import { useStore } from '@store'
import { api } from '@renderer/services/electronAPI'
import { isBinaryFile, safeOpenFile } from '@renderer/utils/fileUtils'
import { t } from '@shared/i18n'
import { toast } from '../common/ToastProvider'
import { ContextMenu, useContextMenu } from '../ui/ContextMenu'
import { resolveChatFilePath } from './chatFilePaths'

export async function activateChatFilePath(value: string, reveal = false): Promise<void> {
  const { workspacePath, language } = useStore.getState()
  const path = resolveChatFilePath(value, workspacePath)
  try {
    if (!path) throw new Error('Unresolved path')
    if (reveal) {
      if (!await api.file.showInFolder(path)) throw new Error('Cannot reveal file')
    } else if (isBinaryFile(path)) {
      if (!await api.file.openWithDefault(path)) throw new Error('Cannot open file')
    } else {
      const stat = await api.file.stat(path)
      if (!stat) throw new Error('File not found')
      if (stat.isDirectory) {
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
