/**
 * Tab context menu component.
 */

import { api } from '@/renderer/services/electronAPI'
import { useEffect, useRef } from 'react'
import { toast } from '../common/ToastProvider'
import { keybindingService, formatShortcut } from '@services/keybindingService'
import { isPreviewDocumentPath } from '@shared/types/preview'
import { t, type Language } from '@shared/i18n'
import { writeClipboardText } from '@/renderer/services/clipboardService'

interface TabContextMenuProps {
  x: number
  y: number
  filePath: string
  onClose: () => void
  onCloseFile: (path: string) => void
  onCloseOthers: (path: string) => void
  onCloseSaved: () => void
  onCloseAll: () => void
  onCloseToRight: (path: string) => void
  onSave: (path: string) => void
  isDirty: boolean
  language: Language
}

export function TabContextMenu({
  x,
  y,
  filePath,
  onClose,
  onCloseFile,
  onCloseOthers,
  onCloseSaved,
  onCloseAll,
  onCloseToRight,
  onSave,
  isDirty,
  language,
}: TabContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const lang = language
  const isPreview = isPreviewDocumentPath(filePath)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (keybindingService.matches(event, 'editor.cancel')) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  const menuItems = [
    { label: t('tabContextMenu.close', lang), action: () => onCloseFile(filePath), shortcut: formatShortcut('Ctrl+W') },
    { label: t('tabContextMenu.closeOthers', lang), action: () => onCloseOthers(filePath) },
    { label: t('tabContextMenu.closeSaved', lang), action: () => onCloseSaved() },
    { label: t('tabContextMenu.closeToTheRight', lang), action: () => onCloseToRight(filePath) },
    { label: t('tabContextMenu.closeAll', lang), action: () => onCloseAll() },
    { type: 'separator' as const },
    ...(!isPreview
      ? [{ label: t('tabContextMenu.save', lang), action: () => onSave(filePath), shortcut: formatShortcut('Ctrl+S'), disabled: !isDirty }, { type: 'separator' as const }]
      : []),
    {
      label: t('copyPath', lang),
      action: async () => {
        const success = await writeClipboardText(filePath)
        if (!success) return
        toast.success(t('tabContextMenu.pathCopied', lang))
      },
    },
    ...(!isPreview
      ? [
          {
            label: t('revealInExplorer', lang),
            action: () => api.file.showInFolder(filePath),
          },
          {
            label: t('cmd.explorer.revealInSidebar', lang),
            action: () => window.dispatchEvent(new CustomEvent('explorer:reveal-file', { detail: { filePath } })),
          },
          { type: 'separator' as const },
          {
            label: t('openInBrowser', lang),
            action: async () => {
              const success = await api.file.openInBrowser(filePath)
              if (!success) {
                toast.error(t('tabContextMenu.failedToOpen', lang))
              }
            },
          },
        ]
      : []),
  ]

  return (
    <div
      ref={menuRef}
      className="fixed bg-background-secondary border border-border-subtle rounded-lg shadow-xl py-1 z-[9999] min-w-[180px]"
      style={{ left: x, top: y }}
    >
      {menuItems.map((item, index) =>
        item.type === 'separator' ? (
          <div key={`separator-${index}`} className="h-px bg-border-subtle my-1" />
        ) : (
          <button
            key={item.label || `item-${index}`}
            onClick={() => {
              void item.action?.()
              onClose()
            }}
            disabled={item.disabled}
            className="w-full px-3 py-1.5 text-left text-sm text-text-primary hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between"
          >
            <span>{item.label}</span>
            {item.shortcut && <span className="text-xs text-text-muted ml-4">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  )
}
