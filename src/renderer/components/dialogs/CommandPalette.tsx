/**
 * 命令面板
 * 类似 Cursor/VS Code 的中央控制枢纽
 */

import { api } from '@/renderer/services/electronAPI'
import { useState, useEffect, useCallback, useRef, memo } from 'react'
import {
  Search, FolderOpen, Settings, Terminal,
  MessageSquare, History, Trash2, RefreshCw, Save,
  X, Zap, Keyboard, Sparkles, Plus, FolderPlus, PanelRight, BookOpen
} from 'lucide-react'
import { useStore, useModeStore } from '@/renderer/store'
import { useShallow } from 'zustand/react/shallow'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { useAgentHistoryActions } from '@/renderer/hooks/useAgent'
import { t } from '@/renderer/i18n'
import { keybindingService, formatShortcut, isMac } from '@/renderer/services/keybindingService'
import { adnifyDir } from '@/renderer/services/adnifyDirService'
import { toast } from '@/renderer/components/common/ToastProvider'
import { useElevatedToastLayer } from '@/renderer/components/common/toastLayerStore'
import { OtterAsset } from '@/renderer/components/brand/OtterAsset'

interface Command {
  id: string
  label: string
  description?: string
  icon: typeof Search
  category: string
  action: () => void
  shortcut?: string
}

interface CommandPaletteProps {
  onClose: () => void
  onShowKeyboardShortcuts: () => void
}

const CommandItem = memo(function CommandItem({
  command,
  isSelected,
  onSelect,
}: {
  command: Command
  isSelected: boolean
  onSelect: () => void
}) {
  const Icon = command.icon

  return (
    <div
      onClick={onSelect}
      className={`
        relative flex items-center gap-3 px-4 py-3 cursor-pointer transition-all duration-200 mx-2 rounded-lg group
        ${isSelected
          ? 'bg-surface-active text-text-primary'
          : 'text-text-secondary hover:bg-surface-hover'}
      `}
    >

      <div className={`p-1.5 rounded-md transition-colors flex-shrink-0 ${isSelected ? 'bg-accent/20 text-accent' : 'bg-surface/50 text-text-muted group-hover:text-text-primary'}`}>
        <Icon className="w-4 h-4" />
      </div>

      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className={`text-sm font-medium transition-colors leading-none mb-1 ${isSelected ? 'text-text-primary' : ''}`}>{command.label}</div>
        {command.description && (
          <div className={`text-[10px] truncate transition-opacity leading-none ${isSelected ? 'text-text-secondary opacity-90' : 'text-text-muted opacity-60'}`}>{command.description}</div>
        )}
      </div>

      {command.shortcut && (
        <kbd className={`
          px-2 py-0.5 text-[10px] font-mono rounded border relative z-10 transition-colors flex-shrink-0
          ${isSelected
            ? 'bg-background/50 border-accent/30 text-accent'
            : 'bg-surface border-border text-text-muted'}
        `}>
          {command.shortcut}
        </kbd>
      )}

      {isSelected && !command.shortcut && (
        <div className="flex-shrink-0 text-[10px] font-mono text-text-muted bg-surface px-1.5 py-0.5 rounded border border-border opacity-0 group-hover:opacity-100 transition-opacity animate-fade-in">
          ⏎ Run
        </div>
      )}
    </div>
  )
})

export default function CommandPalette({ onClose, onShowKeyboardShortcuts }: CommandPaletteProps) {
  useElevatedToastLayer(true)
  // ... (hooks and state logic remains the same)
  const {
    setShowSettings,
    setTerminalVisible,
    terminalVisible,
    workspacePath,
    activeFilePath,
    language,
    setShowQuickOpen,
    setShowAbout,
    setShowChangelog,
    chatVisible,
    setChatVisible,
  } = useStore(useShallow(s => ({
    setShowSettings: s.setShowSettings,
    setTerminalVisible: s.setTerminalVisible,
    terminalVisible: s.terminalVisible,
    workspacePath: s.workspacePath,
    activeFilePath: s.activeFilePath,
    language: s.language,
    setShowQuickOpen: s.setShowQuickOpen,
    setShowAbout: s.setShowAbout,
    setShowChangelog: s.setShowChangelog,
    chatVisible: s.chatVisible,
    setChatVisible: s.setChatVisible,
  })))

  // 从 AgentStore 获取 setInputPrompt
  const setInputPrompt = useAgentStore(state => state.setInputPrompt)

  const setMode = useModeStore(s => s.setMode)

  const { clearMessages, clearCheckpoints } = useAgentHistoryActions()

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 定义所有命令
  const commands: Command[] = [
    // AI Actions (Priority)
    {
      id: 'ai-chat',
      label: 'Ask AI...',
      description: 'Start a new chat conversation',
      icon: Sparkles,
      category: 'AI',
      action: () => {
        setChatVisible(true)
        setMode('agent')
        if (query) setInputPrompt(query)
      }
    },
    {
      id: 'ai-explain',
      label: 'Explain Current File',
      description: 'Ask AI to explain the active file',
      icon: MessageSquare,
      category: 'AI Helper',
      action: () => {
        if (activeFilePath) {
          setChatVisible(true)
          setMode('agent')
          setInputPrompt(`Explain the file ${activeFilePath} in detail.`)
        }
      }
    },
    {
      id: 'ai-refactor',
      label: 'Refactor File',
      description: 'Ask AI to suggest refactoring improvements',
      icon: Zap,
      category: 'AI Helper',
      action: () => {
        if (activeFilePath) {
          setChatVisible(true)
          setMode('agent')
          setInputPrompt(`Analyze ${activeFilePath} and suggest refactoring improvements for readability and performance.`)
        }
      }
    },
    {
      id: 'ai-fix',
      label: 'Fix Bugs',
      description: 'Ask AI to find and fix bugs in current file',
      icon: Zap,
      category: 'AI Helper',
      action: () => {
        if (activeFilePath) {
          setChatVisible(true)
          setMode('agent')
          setInputPrompt(`Find potential bugs in ${activeFilePath} and provide fixes.`)
        }
      }
    },

    // File Operations
    {
      id: 'open-folder',
      label: 'Open Folder',
      description: 'Open a workspace folder',
      icon: FolderOpen,
      category: 'File',
      action: () => api.file.openFolder(),
      shortcut: formatShortcut('Ctrl+O'),
    },
    {
      id: 'new-window',
      label: 'New Window',
      description: 'Open a new application window',
      icon: Plus,
      category: 'Window',
      action: () => api.window.new(),
      shortcut: formatShortcut('Ctrl+Shift+N'),
    },
    {
      id: 'add-folder',
      label: 'Add Folder to Workspace...',
      description: 'Add a new root folder to the current workspace',
      icon: FolderPlus,
      category: 'Workspace',
      action: async () => {
        const path = await api.workspace.addFolder()
        if (path) {
          const { addRoot } = useStore.getState()
          addRoot(path)
          // 初始化新根目录的 .adnify
          await adnifyDir.initialize(path)
          toast.success(`Added ${path} to workspace`)
        }
      },
    },
    {
      id: 'save-workspace',
      label: 'Save Workspace As...',
      description: 'Save the current multi-root workspace configuration',
      icon: Save,
      category: 'Workspace',
      action: async () => {
        const { workspace } = useStore.getState()
        if (workspace) {
          const success = await api.workspace.save(workspace.configPath || '', workspace.roots)
          if (success) toast.success('Workspace saved')
        }
      },
    },
    {
      id: 'save-file',
      label: 'Save File',
      description: 'Save the current file',
      icon: Save,
      category: 'File',
      action: () => {
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 's',
          ctrlKey: !isMac,
          metaKey: isMac,
        }))
      },
      shortcut: formatShortcut('Ctrl+S'),
    },
    {
      id: 'refresh-files',
      label: 'Refresh File Explorer',
      description: 'Reload the file tree',
      icon: RefreshCw,
      category: 'File',
      action: async () => {
        if (workspacePath) {
          const files = await api.file.readDir(workspacePath)
          if (files) {
            useStore.getState().setFiles(files)
          }
        }
      },
    },

    // View & Settings
    {
      id: 'quick-open',
      label: 'Go to File...',
      description: 'Search and open files by name',
      icon: Search,
      category: 'File',
      action: () => setShowQuickOpen(true),
      shortcut: formatShortcut('Ctrl+P'),
    },
    {
      id: 'toggle-terminal',
      label: terminalVisible ? 'Hide Terminal' : 'Show Terminal',
      description: 'Toggle the terminal panel',
      icon: Terminal,
      category: 'View',
      action: () => setTerminalVisible(!terminalVisible),
      shortcut: formatShortcut('Ctrl+`'),
    },
    {
      id: 'toggle-ai-panel',
      label: chatVisible ? 'Hide AI Panel' : 'Show AI Panel',
      description: 'Toggle the AI assistant panel',
      icon: PanelRight,
      category: 'View',
      action: () => setChatVisible(!chatVisible),
      shortcut: formatShortcut('Ctrl+L'),
    },
    {
      id: 'settings',
      label: 'Open Settings',
      description: 'Configure API keys and preferences',
      icon: Settings,
      category: 'Preferences',
      action: () => setShowSettings(true),
      shortcut: formatShortcut('Ctrl+,'),
    },
    {
      id: 'keyboard-shortcuts',
      label: 'Keyboard Shortcuts',
      description: 'View all keyboard shortcuts',
      icon: Keyboard,
      category: 'Help',
      action: () => onShowKeyboardShortcuts(),
      shortcut: '?',
    },
    {
      id: 'about',
      label: 'About Adnify',
      description: 'View application information',
      icon: MessageSquare,
      category: 'Help',
      action: () => setShowAbout(true),
    },
    {
      id: 'view-changelog',
      label: language === 'zh' ? '更新日志 (版本记录)' : 'View Changelog / Release Notes',
      description: language === 'zh' ? '查看所有历史版本与新功能更新记录' : 'View release history and new features',
      icon: BookOpen,
      category: 'Help',
      action: () => setShowChangelog(true),
    },

    // AI Tools
    {
      id: 'clear-chat',
      label: 'Clear Chat History',
      description: 'Remove all messages from the chat',
      icon: Trash2,
      category: 'AI Tools',
      action: () => clearMessages(),
    },
    {
      id: 'clear-checkpoints',
      label: 'Clear All Checkpoints',
      description: 'Remove all saved checkpoints',
      icon: History,
      category: 'AI Tools',
      action: () => clearCheckpoints(),
    },
  ]

  // 过滤命令
  const filteredCommands = commands.filter(cmd => {
    if (!query) return true
    const searchStr = `${cmd.label} ${cmd.description || ''} ${cmd.category}`.toLowerCase()
    return searchStr.includes(query.toLowerCase())
  })

  // 按类别分组
  const groupedCommands = filteredCommands.reduce((acc, cmd) => {
    if (!acc[cmd.category]) {
      acc[cmd.category] = []
    }
    acc[cmd.category].push(cmd)
    return acc
  }, {} as Record<string, Command[]>)

  // 扁平化用于键盘导航
  const flatCommands = Object.values(groupedCommands).flat()

  // 键盘导航
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (keybindingService.matches(e, 'list.focusDown')) {
      e.preventDefault()
      setSelectedIndex(prev => Math.min(prev + 1, flatCommands.length - 1))
    } else if (keybindingService.matches(e, 'list.focusUp')) {
      e.preventDefault()
      setSelectedIndex(prev => Math.max(prev - 1, 0))
    } else if (keybindingService.matches(e, 'list.select')) {
      e.preventDefault()
      if (flatCommands[selectedIndex]) {
        flatCommands[selectedIndex].action()
        onClose()
      }
    } else if (keybindingService.matches(e, 'list.cancel')) {
      e.preventDefault()
      onClose()
    }
  }, [flatCommands, selectedIndex, onClose])

  // 自动聚焦输入框
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 重置选中索引
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // 滚动到选中项
  useEffect(() => {
    if (listRef.current) {
      const selectedEl = listRef.current.querySelector(`[data-index="${selectedIndex}"]`)
      selectedEl?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  let commandIndex = 0

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh] animate-fade-in"
      onClick={onClose}
    >
      <div className="overlay-scrim fixed inset-0 transition-opacity" />

      <div
        className="
            relative w-[640px] max-h-[60vh] flex flex-col
            floating-surface border rounded-2xl
            overflow-hidden animate-scale-in ring-1 ring-text-primary/5 origin-top
        "
        onClick={e => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="floating-surface-header flex items-center gap-4 px-6 py-5 border-b border-border/50 shrink-0">
          <Search className="w-6 h-6 text-text-secondary" strokeWidth={2} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('typeCommandOrSearch', language)}
            className="flex-1 bg-transparent text-xl font-medium text-text-primary placeholder:text-text-muted/55 focus:outline-none"
            spellCheck={false}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="p-1 rounded-full hover:bg-surface-hover transition-colors"
            >
              <X className="w-4 h-4 text-text-muted" />
            </button>
          )}
        </div>

        {/* Command List */}
        <div ref={listRef} className="relative z-[1] flex-1 overflow-y-auto py-3 custom-scrollbar scroll-p-2">
          {Object.entries(groupedCommands).map(([category, cmds]) => (
            <div key={category} className="mb-2">
              <div className="floating-surface-section-label px-6 py-1.5 text-[10px] font-bold uppercase tracking-widest text-text-muted/70 sticky top-0 z-10 mb-1">
                {category}
              </div>
              <div className="space-y-0.5 px-2">
                {cmds.map((cmd) => {
                  const idx = commandIndex++
                  return (
                    <div key={cmd.id} data-index={idx}>
                      <CommandItem
                        command={cmd}
                        isSelected={idx === selectedIndex}
                        onSelect={() => {
                          cmd.action()
                          onClose()
                        }}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {flatCommands.length === 0 && (
            <div className="px-4 py-16 text-center text-text-muted flex flex-col items-center gap-4 opacity-60">
              <div className="w-16 h-16 rounded-full bg-surface/50 flex items-center justify-center border border-border shadow-inner">
                <OtterAsset asset="question" className="h-12 w-12 object-contain" />
              </div>
              <p className="text-sm font-medium">{t('noCommandsFound', language)}</p>
            </div>
          )}
        </div>

        {/* Footer Hint */}
        <div className="floating-surface-footer px-6 py-2.5 border-t border-border/50 text-[10px] font-medium text-text-muted/75 flex justify-between items-center shrink-0">
          <div className="flex gap-4">
            <span className="flex items-center gap-1.5">
              <div className="flex gap-0.5">
                <kbd className="floating-surface-chip font-sans px-1 py-0.5 rounded min-w-[16px] text-center shadow-sm">↑</kbd>
                <kbd className="floating-surface-chip font-sans px-1 py-0.5 rounded min-w-[16px] text-center shadow-sm">↓</kbd>
              </div>
              <span>to navigate</span>
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="floating-surface-chip font-sans px-1.5 py-0.5 rounded shadow-sm">↵</kbd>
              <span>to select</span>
            </span>
          </div>
          <div className="flex items-center gap-2 opacity-50">
            <Sparkles className="w-3 h-3 text-accent" />
            <span className="font-medium tracking-wide">Adnify AI</span>
          </div>
        </div>
      </div>
    </div>
  )
}
