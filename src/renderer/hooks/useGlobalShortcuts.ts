/**
 * 全局快捷键 Hook
 *
 * 所有快捷键定义统一在 src/renderer/config/commands.ts 中管理。
 * 本文件只负责"事件监听 + 派发"，不硬编码任何按键字符串。
 * 用户可通过 keybindingService.updateBinding() 覆盖任意快捷键，本文件无需改动。
 *
 * 注意：
 *   - F1 作为 showCommands 的备用键单独处理（主进程也需要它）
 *   - DevTools 由 Electron 菜单 role:toggleDevTools 负责（主进程 before-input-event 也捕获了 Ctrl+Shift+P/F1）
 */
import { useEffect, useCallback, useRef } from 'react'
import { useStore } from '@store'
import { api } from '@renderer/services/electronAPI'
import { keybindingService } from '@services/keybindingService'

const kb = keybindingService

export function useGlobalShortcuts() {
  // setter 函数引用稳定，直接从 store 获取
  const setShowSettings = useStore((state) => state.setShowSettings)
  const setShowCommandPalette = useStore((state) => state.setShowCommandPalette)
  const setShowComposer = useStore((state) => state.setShowComposer)
  const setShowQuickOpen = useStore((state) => state.setShowQuickOpen)
  const setShowAbout = useStore((state) => state.setShowAbout)
  const setTerminalVisible = useStore((state) => state.setTerminalVisible)
  const setDebugVisible = useStore((state) => state.setDebugVisible)
  const setChatVisible = useStore((state) => state.setChatVisible)
  const closeFile = useStore((state) => state.closeFile)

  // 动态值通过 ref 访问，避免回调依赖
  const stateRef = useRef({
    terminalVisible: false,
    debugVisible: false,
    chatVisible: true,
    showCommandPalette: false,
    showComposer: false,
    showQuickOpen: false,
    showAbout: false,
    activeFilePath: null as string | null,
  })

  // 订阅动态值但不触发 handleKeyDown 重建
  const terminalVisible = useStore((state) => state.terminalVisible)
  const debugVisible = useStore((state) => state.debugVisible)
  const chatVisible = useStore((state) => state.chatVisible)
  const showCommandPalette = useStore((state) => state.showCommandPalette)
  const showComposer = useStore((state) => state.showComposer)
  const showQuickOpen = useStore((state) => state.showQuickOpen)
  const showAbout = useStore((state) => state.showAbout)
  const activeFilePath = useStore((state) => state.activeFilePath)

  stateRef.current = {
    terminalVisible,
    debugVisible,
    chatVisible,
    showCommandPalette,
    showComposer,
    showQuickOpen,
    showAbout,
    activeFilePath,
  }

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const s = stateRef.current

    // ── DevTools: F12（焦点感知）──────────────────────────────────────────────
    // 直接判断 e.key，不依赖 keybindingService（HMR 后命令表可能为空）
    // Windows/Linux 默认 F12，macOS 默认 Cmd+Option+I（Ctrl+Alt+I）
    // 用户可在设置中覆盖 workbench.action.toggleDevTools 来自定义按键
    const isBareF12 = e.key === 'F12' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey
    const isCustomDevToolsTrigger = !isBareF12 && kb.matches(e, 'workbench.action.toggleDevTools')
    if (isBareF12 || isCustomDevToolsTrigger) {
      const active = document.activeElement
      const isEditorFocused = !!(active?.classList.contains('inputarea') || active?.closest('.monaco-editor'))
      if (!isEditorFocused) {
        // 编辑器外：打开 DevTools
        e.preventDefault()
        api.window.toggleDevTools()
      }
      // 编辑器内：放行，Monaco 内部 F12 → 跳转定义（经 DefinitionProvider）
      return
    }

    // Command Palette: commands.ts → workbench.action.showCommands (Ctrl+Shift+P)
    // F1 作为始终有效的备用键单独保留
    if (e.key === 'F1' || kb.matches(e, 'workbench.action.showCommands')) {
      e.preventDefault()
      setShowCommandPalette(true)
      return
    }

    // Quick Open: workbench.action.quickOpen (Ctrl+P)
    if (kb.matches(e, 'workbench.action.quickOpen')) {
      e.preventDefault()
      setShowQuickOpen(true)
      return
    }

    // Settings: workbench.action.openSettings (Ctrl+,)
    if (kb.matches(e, 'workbench.action.openSettings')) {
      e.preventDefault()
      setShowSettings(true)
      return
    }

    // Terminal: view.toggleTerminal (Ctrl+`)
    if (kb.matches(e, 'view.toggleTerminal')) {
      e.preventDefault()
      setTerminalVisible(!s.terminalVisible)
      return
    }

    // Debug Panel: view.toggleDebug (Ctrl+Shift+D)
    if (kb.matches(e, 'view.toggleDebug')) {
      e.preventDefault()
      setDebugVisible(!s.debugVisible)
      return
    }

    // AI Panel: view.toggleAiPanel (Ctrl+L)
    if (kb.matches(e, 'view.toggleAiPanel')) {
      e.preventDefault()
      setChatVisible(!s.chatVisible)
      return
    }

    // Start Debug: debug.start (F5)
    if (kb.matches(e, 'debug.start')) {
      e.preventDefault()
      if (!s.debugVisible) setDebugVisible(true)
      window.dispatchEvent(new CustomEvent('debug:start'))
      return
    }

    // Toggle Breakpoint: debug.toggleBreakpoint (F9)
    if (kb.matches(e, 'debug.toggleBreakpoint')) {
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('debug:toggleBreakpoint'))
      return
    }

    // Composer: workbench.action.toggleComposer (Ctrl+Shift+I)
    if (kb.matches(e, 'workbench.action.toggleComposer')) {
      e.preventDefault()
      setShowComposer(true)
      return
    }

    // Close panels: Escape（直接判断键名，无需绑定到命令 ID）
    if (e.key === 'Escape') {
      if (s.showCommandPalette) setShowCommandPalette(false)
      if (s.showComposer) setShowComposer(false)
      if (s.showQuickOpen) setShowQuickOpen(false)
      if (s.showAbout) setShowAbout(false)
      return
    }

    // Reveal in Explorer: explorer.revealActiveFile (Ctrl+Shift+E)
    if (kb.matches(e, 'explorer.revealActiveFile')) {
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('explorer:reveal-active-file'))
      return
    }

    // Reveal in Sidebar: explorer.revealInSidebar (Alt+Shift+L)
    if (kb.matches(e, 'explorer.revealInSidebar')) {
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('explorer:reveal-active-file'))
      return
    }

    // Close Active File: editor.closeFile (Ctrl+W)
    if (kb.matches(e, 'editor.closeFile')) {
      e.preventDefault()
      if (s.activeFilePath) {
        closeFile(s.activeFilePath)
      }
      return
    }
  }, []) // 空依赖 — setter 和 stateRef 都是稳定的

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // 监听主进程菜单命令
  useEffect(() => {
    const removeListener = api.onExecuteCommand((commandId: string) => {
      if (commandId === 'workbench.action.showCommands') {
        setShowCommandPalette(true)
      }
      if (commandId === 'workbench.action.toggleDevTools') {
        api.window.toggleDevTools()
      }
    })
    return () => { removeListener?.() }
  }, [setShowCommandPalette])
}
