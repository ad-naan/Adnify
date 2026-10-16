/**
 * 全局上下文菜单组件
 * 为输入框（input、textarea、contenteditable）及页面选中文本提供右键复制粘贴菜单
 */
import { memo, useEffect, useRef, useState, useCallback } from 'react'
import { ContextMenu, ContextMenuItem } from '@/renderer/components/ui/ContextMenu'
import { Scissors, Copy, ClipboardPaste, CheckSquare } from 'lucide-react'
import { writeClipboardText, readClipboardText } from '@/renderer/services/clipboardService'
import { formatShortcut } from '@/renderer/services/keybindingService'
import { useStore } from '@/renderer/store'
import { t } from '@shared/i18n'
import { logger } from '@shared/utils/Logger'

interface MenuPosition {
  x: number
  y: number
  isEditable: boolean
  isReadOnly: boolean
  isPassword: boolean
  hasSelection: boolean
  hasText: boolean
}

interface ActiveTargetInfo {
  element: HTMLElement | null
  selectionStart: number | null
  selectionEnd: number | null
  selectedText: string
}

export function getEditableTarget(target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | HTMLElement | null {
  if (!target || !(target instanceof HTMLElement)) return null
  if (target instanceof HTMLInputElement) {
    const nonTextTypes = ['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']
    if (!nonTextTypes.includes(target.type.toLowerCase())) {
      return target
    }
    return null
  }
  if (target instanceof HTMLTextAreaElement) {
    return target
  }
  const contentEditable = target.closest<HTMLElement>('[contenteditable="true"], [contenteditable=""]')
  if (contentEditable) {
    return contentEditable
  }
  return null
}

function isElementReadOnly(target: HTMLElement): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return target.readOnly || target.disabled
  }
  return target.getAttribute('aria-readonly') === 'true' || target.getAttribute('contenteditable') === 'false'
}

function isElementPassword(target: HTMLElement): boolean {
  return target instanceof HTMLInputElement && target.type.toLowerCase() === 'password'
}

export function insertTextIntoElement(element: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  element.focus()
  const valBefore = element.value
  const start = element.selectionStart ?? 0
  const end = element.selectionEnd ?? 0

  let execSucceeded = false
  try {
    if (text === '') {
      execSucceeded = document.execCommand('delete') || document.execCommand('insertText', false, '')
    } else {
      execSucceeded = document.execCommand('insertText', false, text)
    }
  } catch {
    execSucceeded = false
  }

  // 如果 execCommand 没有触发内容改变（且原选区非空或要插入的非空），使用 prototype setter 兜底并派发事件
  const valueChanged = element.value !== valBefore
  if (!execSucceeded || (!valueChanged && (text !== '' || start !== end))) {
    const before = element.value.substring(0, start)
    const after = element.value.substring(end)
    const nextValue = before + text + after

    const proto = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
    const valueSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    if (valueSetter) {
      valueSetter.call(element, nextValue)
    } else {
      element.value = nextValue
    }

    const nextCaret = start + text.length
    try {
      element.setSelectionRange(nextCaret, nextCaret)
    } catch {
      // 某些特殊 input 类型可能不支持 setSelectionRange
    }
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }
}

export const GlobalContextMenu = memo(function GlobalContextMenu() {
  const language = useStore((state) => state.language)
  const [menuState, setMenuState] = useState<MenuPosition | null>(null)
  const activeTargetRef = useRef<ActiveTargetInfo | null>(null)

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // 若子组件已显式阻止默认事件（如 Monaco 编辑器、文件树等），则不处理
      if (e.defaultPrevented) return

      const editableTarget = getEditableTarget(e.target)
      const selectedText = window.getSelection()?.toString() || ''

      // 既不是输入框，也没有选中文本，则不弹出
      if (!editableTarget && !selectedText.trim()) return

      e.preventDefault()

      let selectionStart: number | null = null
      let selectionEnd: number | null = null
      let hasSelection = false
      let hasText = false

      if (editableTarget instanceof HTMLInputElement || editableTarget instanceof HTMLTextAreaElement) {
        try {
          selectionStart = editableTarget.selectionStart
          selectionEnd = editableTarget.selectionEnd
          hasSelection = (selectionEnd ?? 0) > (selectionStart ?? 0)
        } catch {
          hasSelection = false
        }
        hasText = editableTarget.value.length > 0
      } else if (editableTarget && editableTarget.isContentEditable) {
        hasSelection = selectedText.length > 0
        hasText = (editableTarget.textContent?.length ?? 0) > 0
      } else {
        hasSelection = selectedText.length > 0
        hasText = true
      }

      const readOnly = editableTarget ? isElementReadOnly(editableTarget) : true
      const password = editableTarget ? isElementPassword(editableTarget) : false

      activeTargetRef.current = {
        element: editableTarget,
        selectionStart,
        selectionEnd,
        selectedText,
      }

      setMenuState({
        x: e.clientX,
        y: e.clientY,
        isEditable: Boolean(editableTarget),
        isReadOnly: readOnly,
        isPassword: password,
        hasSelection,
        hasText,
      })
    }

    document.addEventListener('contextmenu', handleContextMenu, false)
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu, false)
    }
  }, [])

  const handleClose = useCallback(() => {
    setMenuState(null)
  }, [])

  const handleCut = useCallback(async () => {
    const info = activeTargetRef.current
    if (!info?.element) return
    const { element, selectionStart, selectionEnd } = info

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (element.readOnly || element.disabled) return
      const start = selectionStart ?? 0
      const end = selectionEnd ?? 0
      const textToCut = element.value.substring(start, end)
      if (textToCut) {
        await writeClipboardText(textToCut)
        element.focus()
        try {
          element.setSelectionRange(start, end)
        } catch {}
        insertTextIntoElement(element, '')
      }
    } else if (element.isContentEditable) {
      const textToCut = window.getSelection()?.toString() || ''
      if (textToCut) {
        await writeClipboardText(textToCut)
        element.focus()
        document.execCommand('delete')
      }
    }
  }, [])

  const handleCopy = useCallback(async () => {
    const info = activeTargetRef.current
    if (!info) return
    const { element, selectionStart, selectionEnd, selectedText } = info

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const start = selectionStart ?? 0
      const end = selectionEnd ?? 0
      const textToCopy = element.value.substring(start, end)
      if (textToCopy) {
        await writeClipboardText(textToCopy)
      }
    } else {
      const textToCopy = selectedText || window.getSelection()?.toString() || ''
      if (textToCopy) {
        await writeClipboardText(textToCopy)
      }
    }
  }, [])

  const handlePaste = useCallback(async () => {
    const info = activeTargetRef.current
    if (!info?.element) return
    const { element, selectionStart, selectionEnd } = info

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (element.readOnly || element.disabled) return
      element.focus()
      if (selectionStart !== null && selectionEnd !== null) {
        try {
          element.setSelectionRange(selectionStart, selectionEnd)
        } catch {}
      }

      // 先尝试原生 execCommand('paste')
      const valBefore = element.value
      let pasted = false
      try {
        pasted = document.execCommand('paste')
      } catch {
        pasted = false
      }

      // 若原生 paste 没有改变内容，使用剪贴板服务读取文字插入
      if (!pasted || element.value === valBefore) {
        try {
          const text = await readClipboardText()
          if (text) {
            insertTextIntoElement(element, text)
          }
        } catch (err) {
          logger.ui.error('Failed to paste from clipboard:', err)
        }
      }
    } else if (element.isContentEditable) {
      element.focus()
      let pasted = false
      try {
        pasted = document.execCommand('paste')
      } catch {
        pasted = false
      }
      if (!pasted) {
        try {
          const text = await readClipboardText()
          if (text) {
            document.execCommand('insertText', false, text)
          }
        } catch (err) {
          logger.ui.error('Failed to paste into contentEditable:', err)
        }
      }
    }
  }, [])

  const handleSelectAll = useCallback(() => {
    const info = activeTargetRef.current
    if (!info) return
    const { element } = info

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.focus()
      element.select()
    } else if (element?.isContentEditable) {
      element.focus()
      const range = document.createRange()
      range.selectNodeContents(element)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    } else {
      document.execCommand('selectAll')
    }
  }, [])

  if (!menuState) return null

  const items: ContextMenuItem[] = menuState.isEditable
    ? [
        {
          id: 'cut',
          label: t('ctxCut', language),
          icon: Scissors,
          shortcut: formatShortcut('Ctrl+X'),
          disabled: menuState.isReadOnly || menuState.isPassword || !menuState.hasSelection,
          onClick: handleCut,
        },
        {
          id: 'copy',
          label: t('ctxCopy', language),
          icon: Copy,
          shortcut: formatShortcut('Ctrl+C'),
          disabled: menuState.isPassword || !menuState.hasSelection,
          onClick: handleCopy,
        },
        {
          id: 'paste',
          label: t('ctxPaste', language),
          icon: ClipboardPaste,
          shortcut: formatShortcut('Ctrl+V'),
          disabled: menuState.isReadOnly,
          onClick: handlePaste,
        },
        {
          id: 'sep',
          label: '',
          separator: true,
        },
        {
          id: 'select-all',
          label: t('selectAll', language),
          icon: CheckSquare,
          shortcut: formatShortcut('Ctrl+A'),
          disabled: !menuState.hasText,
          onClick: handleSelectAll,
        },
      ]
    : [
        {
          id: 'copy',
          label: t('ctxCopy', language),
          icon: Copy,
          shortcut: formatShortcut('Ctrl+C'),
          disabled: !menuState.hasSelection,
          onClick: handleCopy,
        },
        {
          id: 'sep',
          label: '',
          separator: true,
        },
        {
          id: 'select-all',
          label: t('selectAll', language),
          icon: CheckSquare,
          shortcut: formatShortcut('Ctrl+A'),
          onClick: handleSelectAll,
        },
      ]

  return (
    <ContextMenu
      x={menuState.x}
      y={menuState.y}
      items={items}
      onClose={handleClose}
    />
  )
})
