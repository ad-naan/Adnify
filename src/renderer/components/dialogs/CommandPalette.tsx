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
import { workspaceFiles } from '@/renderer/services/workspaceFileRepository'
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

  const isZh = language === 'zh'

  // 定义所有命令
  const commands: Command[] = [
    // AI Actions (Priority)
    {
      id: 'ai-chat',
      label: isZh ? '询问 AI...' : 'Ask AI...',
      description: isZh ? '发起新的 AI 对话会话' : 'Start a new chat conversation',
      icon: Sparkles,
      category: isZh ? 'AI 助手' : 'AI Helper',
      action: () => {
        setChatVisible(true)
        setMode('agent')
        if (query) setInputPrompt(query)
      }
    },
    {
      id: 'ai-explain',
      label: isZh ? '解释当前文件' : 'Explain Current File',
      description: isZh ? '让 AI 详细分析并解释当前激活的文件' : 'Ask AI to explain the active file',
      icon: MessageSquare,
      category: isZh ? 'AI 助手' : 'AI Helper',
      action: () => {
        if (activeFilePath) {
          setChatVisible(true)
          setMode('agent')
          setInputPrompt(isZh ? `请详细解释文件 ${activeFilePath} 的结构与核心逻辑。` : `Explain the file ${activeFilePath} in detail.`)
        }
      }
    },
    {
      id: 'ai-refactor',
      label: isZh ? '重构当前文件' : 'Refactor File',
      description: isZh ? '让 AI 提出代码重构与性能可读性优化建议' : 'Ask AI to suggest refactoring improvements',
      icon: Zap,
      category: isZh ? 'AI 助手' : 'AI Helper',
      action: () => {
        if (activeFilePath) {
          setChatVisible(true)
          setMode('agent')
          setInputPrompt(isZh ? `请分析 ${activeFilePath} 并提出重构改进方案，提升可读性与性能。` : `Analyze ${activeFilePath} and suggest refactoring improvements for readability and performance.`)
        }
      }
    },
    {
      id: 'ai-fix',
      label: isZh ? '修复当前文件问题' : 'Fix Bugs',
      description: isZh ? '让 AI 排查潜在缺陷并生成修复方案' : 'Ask AI to find and fix bugs in current file',
      icon: Zap,
      category: isZh ? 'AI 助手' : 'AI Helper',
      action: () => {
        if (activeFilePath) {
          setChatVisible(true)
          setMode('agent')
          setInputPrompt(isZh ? `请排查 ${activeFilePath} 中的潜在问题并给出修复建议。` : `Find potential bugs in ${activeFilePath} and provide fixes.`)
        }
      }
    },

    // File Operations
    {
      id: 'open-folder',
      label: isZh ? '打开文件夹' : 'Open Folder',
      description: isZh ? '打开工作区目录' : 'Open a workspace folder',
      icon: FolderOpen,
      category: isZh ? '文件' : 'File',
      action: () => api.file.openFolder(),
      shortcut: formatShortcut('Ctrl+O'),
    },
    {
      id: 'new-window',
      label: isZh ? '新建窗口' : 'New Window',
      description: isZh ? '打开新的应用窗口' : 'Open a new application window',
      icon: Plus,
      category: isZh ? '窗口' : 'Window',
      action: () => api.window.new(),
      shortcut: formatShortcut('Ctrl+Shift+N'),
    },
    {
      id: 'add-folder',
      label: isZh ? '添加文件夹到工作区...' : 'Add Folder to Workspace...',
      description: isZh ? '为当前工作区添加新的根目录' : 'Add a new root folder to the current workspace',
      icon: FolderPlus,
      category: isZh ? '工作区' : 'Workspace',
      action: async () => {
        const path = await api.workspace.addFolder()
        if (path) {
          const { addRoot } = useStore.getState()
          addRoot(path)
          await workspaceFiles.initialize(path)
          toast.success(isZh ? `已添加 ${path} 到工作区` : `Added ${path} to workspace`)
        }
      },
    },
    {
      id: 'save-workspace',
      label: isZh ? '工作区另存为...' : 'Save Workspace As...',
      description: isZh ? '保存当前多根工作区配置' : 'Save the current multi-root workspace configuration',
      icon: Save,
      category: isZh ? '工作区' : 'Workspace',
      action: async () => {
        const { workspace } = useStore.getState()
        if (workspace) {
          const success = await api.workspace.save(workspace.configPath || '', workspace.roots)
          if (success) toast.success(isZh ? '工作区已保存' : 'Workspace saved')
        }
      },
    },
    {
      id: 'save-file',
      label: isZh ? '保存文件' : 'Save File',
      description: isZh ? '保存当前正在编辑的文件' : 'Save the current file',
      icon: Save,
      category: isZh ? '文件' : 'File',
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
      label: isZh ? '刷新文件资源管理器' : 'Refresh File Explorer',
      description: isZh ? '重新加载文件目录树' : 'Reload the file tree',
      icon: RefreshCw,
      category: isZh ? '文件' : 'File',
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
      label: isZh ? '快速打开文件...' : 'Go to File...',
      description: isZh ? '按名称搜索并打开文件' : 'Search and open files by name',
      icon: Search,
      category: isZh ? '文件' : 'File',
      action: () => setShowQuickOpen(true),
      shortcut: formatShortcut('Ctrl+P'),
    },
    {
      id: 'toggle-terminal',
      label: terminalVisible ? (isZh ? '隐藏终端' : 'Hide Terminal') : (isZh ? '显示终端' : 'Show Terminal'),
      description: isZh ? '切换终端面板的显示与隐藏' : 'Toggle the terminal panel',
      icon: Terminal,
      category: isZh ? '视图' : 'View',
      action: () => setTerminalVisible(!terminalVisible),
      shortcut: formatShortcut('Ctrl+`'),
    },
    {
      id: 'toggle-ai-panel',
      label: chatVisible ? (isZh ? '隐藏 AI 面板' : 'Hide AI Panel') : (isZh ? '显示 AI 面板' : 'Show AI Panel'),
      description: isZh ? '切换 AI 助手对话面板的显示' : 'Toggle the AI assistant panel',
      icon: PanelRight,
      category: isZh ? '视图' : 'View',
      action: () => setChatVisible(!chatVisible),
      shortcut: formatShortcut('Ctrl+L'),
    },
    {
      id: 'settings',
      label: isZh ? '打开设置' : 'Open Settings',
      description: isZh ? '配置 API 密钥、模型与系统偏好' : 'Configure API keys and preferences',
      icon: Settings,
      category: isZh ? '偏好设置' : 'Preferences',
      action: () => setShowSettings(true),
      shortcut: formatShortcut('Ctrl+,'),
    },
    {
      id: 'keyboard-shortcuts',
      label: isZh ? '快捷键列表' : 'Keyboard Shortcuts',
      description: isZh ? '查看所有键盘快捷键' : 'View all keyboard shortcuts',
      icon: Keyboard,
      category: isZh ? '帮助' : 'Help',
      action: () => onShowKeyboardShortcuts(),
      shortcut: '?',
    },
    {
      id: 'about',
      label: isZh ? '关于 Adnify' : 'About Adnify',
      description: isZh ? '查看应用版本与相关信息' : 'View application information',
      icon: MessageSquare,
      category: isZh ? '帮助' : 'Help',
      action: () => setShowAbout(true),
    },
    {
      id: 'view-changelog',
      label: isZh ? '更新日志 (版本记录)' : 'View Changelog / Release Notes',
      description: isZh ? '查看所有历史版本与新功能更新记录' : 'View release history and new features',
      icon: BookOpen,
      category: isZh ? '帮助' : 'Help',
      action: () => setShowChangelog(true),
    },

    // AI Tools
    {
      id: 'clear-chat',
      label: isZh ? '清空对话历史' : 'Clear Chat History',
      description: isZh ? '移除当前对话中的所有消息记录' : 'Remove all messages from the chat',
      icon: Trash2,
      category: isZh ? 'AI 工具' : 'AI Tools',
      action: () => clearMessages(),
    },
    {
      id: 'clear-checkpoints',
      label: isZh ? '清除所有检查点' : 'Clear All Checkpoints',
      description: isZh ? '删除已保存的所有历史快照与检查点' : 'Remove all saved checkpoints',
      icon: History,
      category: isZh ? 'AI 工具' : 'AI Tools',
      action: () => clearCheckpoints(),
    },
  ]

  // 过滤命令（同时支持中文与英文关键词）
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
              <span>{isZh ? '导航' : 'to navigate'}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="floating-surface-chip font-sans px-1.5 py-0.5 rounded shadow-sm">↵</kbd>
              <span>{isZh ? '选择执行' : 'to select'}</span>
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
