import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  GitBranch,
  AlertCircle,
  XCircle,
  Database,
  Loader2,
  Cpu,
  Terminal,
  CheckCircle2,
  ScrollText,
  Maximize2,
  MessageSquare,
  Bug,
  ListTodo,
  Bell,
  Volume2,
  Search,
  RefreshCw,
  Check,
  ArrowUpRight,
} from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import type { IndexStatus } from '@shared/types'
import { indexWorkerService, type IndexProgress } from '@services/indexWorkerService'
import BottomBarPopover from '../ui/BottomBarPopover'
import ToolCallLogContent from '../panels/ToolCallLogContent'
import ContextStatsContent from '../panels/ContextStatsContent'
import PlanListContent from '../panels/PlanListContent'
import NotificationCenterContent from '../panels/NotificationCenterContent'
import { useInlineToast } from '../common/InlineToast'
import { useHasElevatedToastLayer } from '../common/toastLayerStore'
import {
  useAgentStore,
  selectMessageCount,
  selectMessageListState,
  selectCompressionStats,
  selectContextIndicatorKind,
} from '@renderer/agent/store/AgentStore'
import { isAssistantMessage, type TokenUsage } from '@renderer/agent/types'
import { useDiagnosticsStore, getFileStats } from '@services/diagnosticsStore'
import LspStatusIndicator from './LspStatusIndicator'
import LocalServersIndicator from './LocalServersIndicator'
import { EmotionStatusIndicator } from '../agent/EmotionStatusIndicator'
import { motion, AnimatePresence } from 'framer-motion'
import FileFormatControls from './FileFormatControls'
import { gitService, type GitBranch as GitBranchInfo } from '@renderer/services/gitService'
import { toast } from '../common/ToastProvider'
import { pathStartsWith } from '@shared/utils/pathUtils'
import AdministratorModeIndicator from './AdministratorModeIndicator'

export default function StatusBar() {
  const {
    activeFilePath,
    workspacePath,
    setShowSettings,
    language,
    terminalVisible,
    setTerminalVisible,
    debugVisible,
    setDebugVisible,
    cursorPosition,
    isGitRepo,
    gitStatus,
    gitBranches,
    setGitStatus,
    setGitBranches,
    setIsGitRepo,
    setActiveSidePanel,
  } = useStore(useShallow(s => ({
    activeFilePath: s.activeFilePath,
    workspacePath: s.workspacePath,
    setShowSettings: s.setShowSettings,
    language: s.language,
    terminalVisible: s.terminalVisible,
    setTerminalVisible: s.setTerminalVisible,
    debugVisible: s.debugVisible,
    setDebugVisible: s.setDebugVisible,
    cursorPosition: s.cursorPosition,
    isGitRepo: s.isGitRepo,
    gitStatus: s.gitStatus,
    gitBranches: s.gitBranches,
    setGitStatus: s.setGitStatus,
    setGitBranches: s.setGitBranches,
    setIsGitRepo: s.setIsGitRepo,
    setActiveSidePanel: s.setActiveSidePanel,
  })))

  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null)
  const [workerProgress, setWorkerProgress] = useState<IndexProgress | null>(null)
  const [branchQuery, setBranchQuery] = useState('')
  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null)
  const gitRefreshRunRef = useRef(0)

  const refreshGitState = useCallback(async () => {
    const runId = ++gitRefreshRunRef.current
    if (!workspacePath) {
      setIsGitRepo(false)
      setGitStatus(null)
      setGitBranches([])
      return
    }

    const repo = await gitService.isGitRepo(workspacePath)
    if (runId !== gitRefreshRunRef.current) return
    setIsGitRepo(repo)

    if (!repo) {
      setGitStatus(null)
      setGitBranches([])
      return
    }

    const [status, branches] = await Promise.all([
      gitService.getStatus(workspacePath),
      gitService.getBranches(workspacePath),
    ])
    if (runId !== gitRefreshRunRef.current) return
    setGitStatus(status)
    setGitBranches(branches)
  }, [setGitBranches, setGitStatus, setIsGitRepo, workspacePath])

  useEffect(() => {
    setIsGitRepo(false)
    setGitStatus(null)
    setGitBranches([])
    void refreshGitState()
    if (!workspacePath) return

    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => void refreshGitState(), 250)
    }
    const unsubscribe = api.file.onChanged((event: { path: string }) => {
      if (pathStartsWith(event.path, workspacePath) && /[\\/]\.git(?:[\\/]|$)/.test(event.path)) {
        scheduleRefresh()
      }
    })
    const handleFocus = () => void refreshGitState()
    window.addEventListener('focus', handleFocus)

    // Linked worktrees can keep HEAD outside the watched workspace. A cheap
    // branch-only check closes that gap while the IDE is visible.
    const branchPoll = window.setInterval(async () => {
      if (document.visibilityState !== 'visible') return
      const branch = await gitService.getCurrentBranch(workspacePath)
      const displayedBranch = useStore.getState().gitStatus?.branch
      if (branch !== null && (branch || 'HEAD') !== displayedBranch) scheduleRefresh()
    }, 3000)

    return () => {
      unsubscribe()
      window.removeEventListener('focus', handleFocus)
      window.clearInterval(branchPoll)
      if (debounceTimer) clearTimeout(debounceTimer)
    }
  }, [refreshGitState, setGitBranches, setGitStatus, setIsGitRepo, workspacePath])

  const visibleBranches = useMemo(() => {
    const query = branchQuery.trim().toLocaleLowerCase()
    return gitBranches.filter(branch => !query || branch.name.toLocaleLowerCase().includes(query))
  }, [branchQuery, gitBranches])

  const handleSwitchBranch = useCallback(async (branch: GitBranchInfo) => {
    if (!workspacePath || branch.current || switchingBranch) return
    setSwitchingBranch(branch.name)
    const result = branch.remote
      ? await gitService.checkoutRemoteBranch(branch.name, workspacePath)
      : await gitService.checkoutBranch(branch.name, workspacePath)

    if (result.success) {
      await refreshGitState()
      setBranchQuery('')
      toast.success(
        language === 'zh' ? '已切换分支' : 'Branch switched',
        'branch' in result && typeof result.branch === 'string' ? result.branch : branch.name,
      )
    } else {
      toast.error(language === 'zh' ? '无法切换分支' : 'Could not switch branch', result.error)
    }
    setSwitchingBranch(null)
  }, [language, refreshGitState, switchingBranch, workspacePath])

  const { toasts, visibleIds } = useInlineToast()
  const notificationCount = toasts.length
  const latestVisibleToastId = [...visibleIds].reverse().find(id => {
    const toast = toasts.find(item => item.id === id)
    return toast?.variant === 'inline'
  })
  const activeToast = latestVisibleToastId ? toasts.find(t => t.id === latestVisibleToastId) : null
  const shouldEject = useHasElevatedToastLayer()

  const diagnostics = useDiagnosticsStore(state => state.diagnostics)
  const version = useDiagnosticsStore(state => state.version)
  const currentFileStats = useMemo(() => getFileStats(diagnostics, activeFilePath), [activeFilePath, version, diagnostics])

  const messageCount = useAgentStore(selectMessageCount)
  const currentThreadId = useAgentStore(state => state.currentThreadId)
  const messageListVersion = useAgentStore(state => selectMessageListState(state).version)
  const compressionStats = useAgentStore(selectCompressionStats)
  const contextIndicatorKind = useAgentStore(selectContextIndicatorKind)

  const tokenStats = useMemo(() => {
    const messages = useAgentStore.getState().getMessages()
    const totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    let lastUsage: TokenUsage | undefined

    for (const msg of messages) {
      if (isAssistantMessage(msg) && msg.usage) {
        totalUsage.promptTokens += msg.usage.promptTokens
        totalUsage.completionTokens += msg.usage.completionTokens
        totalUsage.totalTokens += msg.usage.totalTokens
        totalUsage.cachedInputTokens = (totalUsage.cachedInputTokens || 0) + (msg.usage.cachedInputTokens || 0)
        totalUsage.cacheWriteTokens = (totalUsage.cacheWriteTokens || 0) + (msg.usage.cacheWriteTokens || 0)
        totalUsage.reasoningTokens = (totalUsage.reasoningTokens || 0) + (msg.usage.reasoningTokens || 0)
        if (msg.usage.cacheReadSource === 'provider-reported') {
          totalUsage.cacheReadSource = 'provider-reported'
        } else if (!totalUsage.cacheReadSource && msg.usage.cacheReadSource) {
          totalUsage.cacheReadSource = msg.usage.cacheReadSource
        }
        if (msg.usage.cacheWriteSource === 'provider-reported') {
          totalUsage.cacheWriteSource = 'provider-reported'
        } else if (!totalUsage.cacheWriteSource && msg.usage.cacheWriteSource) {
          totalUsage.cacheWriteSource = msg.usage.cacheWriteSource
        }
        lastUsage = msg.usage
      }
    }

    return { totalUsage, lastUsage }
  }, [currentThreadId, messageCount, messageListVersion])

  useEffect(() => {
    indexWorkerService.initialize()
    const unsubProgress = indexWorkerService.onProgress(setWorkerProgress)
    const unsubError = indexWorkerService.onError(error => {
      logger.ui.error('[StatusBar] Worker error:', error)
    })

    return () => {
      unsubProgress()
      unsubError()
    }
  }, [])

  useEffect(() => {
    if (!workspacePath) {
      setIndexStatus(null)
      return
    }

    api.index.status(workspacePath).then(setIndexStatus)
    const unsubscribe = api.index.onProgress(setIndexStatus)
    return unsubscribe
  }, [workspacePath])

  const handleIndexClick = () => setShowSettings(true)
  const handleDiagnosticsClick = () => setActiveSidePanel('problems')
  const toolCallLogs = useStore(state => state.toolCallLogs)
  const currentThreadToolCallCount = useMemo(
    () => currentThreadId ? toolCallLogs.filter(log => log.threadId === currentThreadId).length : 0,
    [currentThreadId, toolCallLogs]
  )
  const plans = useAgentStore(state => state.plans)
  const loadPlansFromStorage = useAgentStore(state => state.loadPlansFromStorage)

  useEffect(() => {
    if (workspacePath) {
      loadPlansFromStorage()
    }
  }, [workspacePath, loadPlansFromStorage])

  const executingPlansCount = plans.filter(plan =>
    plan.status === 'executing' || plan.status === 'pausing' || plan.status === 'stopping'
  ).length

  const layerColorClass =
    compressionStats?.memoryHealth?.risk === 'high' ? 'text-red-400 drop-shadow-[0_0_6px_rgba(248,113,113,0.4)]' :
      compressionStats?.memoryHealth?.risk === 'medium' ? 'text-yellow-400 drop-shadow-[0_0_6px_rgba(250,204,21,0.4)]' :
        compressionStats?.memoryHealth?.risk === 'low' ? 'text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.4)]' :
          compressionStats?.level === 4 ? 'text-red-400 drop-shadow-[0_0_6px_rgba(248,113,113,0.4)]' :
            compressionStats?.level === 3 ? 'text-orange-400 drop-shadow-[0_0_6px_rgba(251,146,60,0.4)]' :
              compressionStats?.level === 2 ? 'text-yellow-400 drop-shadow-[0_0_6px_rgba(250,204,21,0.4)]' :
                compressionStats?.level === 1 ? 'text-blue-400 drop-shadow-[0_0_6px_rgba(96,165,250,0.4)]' :
                  'text-text-muted group-hover:text-text-primary'

  const contextIndicatorCopy = useMemo(() => ({
    compressing: language === 'zh' ? '压缩中' : 'Compressing',
    handoffReady: language === 'zh' ? '已生成交接包' : 'Handoff Ready',
    switching: language === 'zh' ? '切换中' : 'Switching',
    switched: language === 'zh' ? '已切换' : 'Switched',
  }), [language])
  const peakContextUsage = compressionStats?.peakRatio ?? null

  return (
    <div className="h-8 bg-background-secondary/40 backdrop-blur-md flex items-center justify-between px-3 text-[10px] select-none text-text-muted z-50 font-medium border-t border-border/30 shadow-[0_-1px_15px_rgba(0,0,0,0.03)]">
      <div className="flex items-center gap-3">
        <EmotionStatusIndicator />

        {isGitRepo && gitStatus && (
          <BottomBarPopover
            tooltip={language === 'zh' ? '切换 Git 分支' : 'Switch Git branch'}
            title={language === 'zh' ? 'Git 分支' : 'Git branches'}
            width={320}
            height={360}
            onOpenChange={open => {
              if (open) void refreshGitState()
            }}
            icon={
              <div className="group flex items-center gap-1.5 px-1 text-text-muted hover:text-text-primary">
                <GitBranch className="h-3 w-3 transition-colors" />
                <span className="max-w-44 truncate font-medium tracking-wide">{gitStatus.branch}</span>
              </div>
            }
          >
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex items-center gap-2 border-b border-border/40 p-2.5">
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border/50 bg-background/40 px-2.5 focus-within:border-accent/50">
                  <Search className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                  <input
                    value={branchQuery}
                    onChange={event => setBranchQuery(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        const target = visibleBranches.find(branch => !branch.current)
                        if (target) void handleSwitchBranch(target)
                      }
                    }}
                    placeholder={language === 'zh' ? '搜索分支…' : 'Search branches…'}
                    className="h-8 min-w-0 flex-1 bg-transparent text-[11px] text-text-primary outline-none placeholder:text-text-muted/60"
                    aria-label={language === 'zh' ? '搜索 Git 分支' : 'Search Git branches'}
                  />
                </div>
                <button
                  onClick={() => void refreshGitState()}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-white/5 hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                  title={language === 'zh' ? '刷新分支' : 'Refresh branches'}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-1.5 custom-scrollbar">
                {visibleBranches.length > 0 ? visibleBranches.map(branch => (
                  <button
                    key={`${branch.remote ? 'remote' : 'local'}:${branch.name}`}
                    onClick={() => void handleSwitchBranch(branch)}
                    disabled={branch.current || switchingBranch !== null}
                    className={`group flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                      branch.current ? 'bg-accent/10 text-accent' : 'text-text-primary hover:bg-white/5 disabled:opacity-50'
                    }`}
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                      {switchingBranch === branch.name
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : branch.current
                          ? <Check className="h-3.5 w-3.5" />
                          : <GitBranch className="h-3.5 w-3.5 text-text-muted group-hover:text-text-primary" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{branch.name}</span>
                    <span className="shrink-0 text-[9px] uppercase tracking-wider text-text-muted/70">
                      {branch.current
                        ? (language === 'zh' ? '当前' : 'current')
                        : branch.remote
                          ? (language === 'zh' ? '远程' : 'remote')
                          : ''}
                    </span>
                  </button>
                )) : (
                  <div className="flex h-24 items-center justify-center text-[11px] text-text-muted">
                    {language === 'zh' ? '没有匹配的分支' : 'No matching branches'}
                  </div>
                )}
              </div>

              <button
                onClick={() => setActiveSidePanel('git')}
                className="flex h-10 shrink-0 items-center justify-between border-t border-border/40 px-3 text-[10px] font-medium text-text-muted transition-colors hover:bg-white/5 hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
              >
                <span>{language === 'zh' ? '打开完整 Git 面板' : 'Open full Git panel'}</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </BottomBarPopover>
        )}

        <button
          onClick={handleDiagnosticsClick}
          className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-white/5 transition-colors text-text-muted group hover:text-text-primary"
        >
          <div className="flex items-center gap-1">
            <div className="flex items-center justify-center w-4 h-4 transition-colors">
              <XCircle className={`w-3 h-3 ${currentFileStats.errors > 0 ? 'text-red-400 drop-shadow-[0_0_6px_rgba(248,113,113,0.4)]' : 'text-text-muted group-hover:text-text-primary transition-colors'}`} />
            </div>
            <span className={`font-medium ${currentFileStats.errors > 0 ? 'text-red-400' : 'text-text-muted group-hover:text-text-primary'}`}>{currentFileStats.errors}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="flex items-center justify-center w-4 h-4 transition-colors">
              <AlertCircle className={`w-3 h-3 ${currentFileStats.warnings > 0 ? 'text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.4)]' : 'text-text-muted group-hover:text-text-primary transition-colors'}`} />
            </div>
            <span className={`font-medium ${currentFileStats.warnings > 0 ? 'text-amber-400' : 'text-text-muted group-hover:text-text-primary'}`}>{currentFileStats.warnings}</span>
          </div>
        </button>

        {workerProgress && !workerProgress.isComplete && workerProgress.total > 0 && (
          <div className="flex items-center gap-1.5 text-accent animate-fade-in px-2 py-0.5 rounded-md transition-colors hover:bg-white/5 cursor-default">
            <div className="flex items-center justify-center w-4 h-4 drop-shadow-[0_0_6px_rgba(var(--accent-rgb),0.5)]">
              <Cpu className="w-3 h-3 animate-pulse text-accent" />
            </div>
            <span className="font-medium">{workerProgress.message || `${Math.round((workerProgress.processed / workerProgress.total) * 100)}%`}</span>
          </div>
        )}

        {workspacePath && (
          <button
            onClick={handleIndexClick}
            className="flex items-center justify-center w-6 h-6 rounded-md hover:bg-white/5 transition-colors group"
          >
            {indexStatus?.isIndexing ? (
              <div className="flex items-center justify-center w-4 h-4 drop-shadow-[0_0_6px_rgba(var(--accent-rgb),0.5)]">
                <Loader2 className="w-3 h-3 animate-spin text-accent" />
              </div>
            ) : indexStatus?.totalChunks ? (
              <div className="flex items-center justify-center w-4 h-4 drop-shadow-[0_0_6px_rgba(52,211,153,0.5)]">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              </div>
            ) : (
              <div className="flex items-center justify-center w-4 h-4">
                <Database className="w-3 h-3 text-text-muted group-hover:text-text-primary transition-colors" />
              </div>
            )}
          </button>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-4 h-full">
        <div className="flex items-center gap-3 pr-1 h-full font-mono">
          <div className="flex items-center gap-2 cursor-pointer hover:bg-white/5 hover:text-text-primary px-2 py-1 rounded-md transition-colors text-[9px] hidden md:flex">
            <span>Ln {cursorPosition?.line || 1}, Col {cursorPosition?.column || 1}</span>
          </div>
          <FileFormatControls />
          <AdministratorModeIndicator />
          <LspStatusIndicator />
        </div>

        <div className="flex items-center gap-1 h-full">
          <BottomBarPopover
            icon={
              <AnimatePresence mode="wait">
                {contextIndicatorKind === 'switching' ? (
                  <motion.div
                    key="transitioning"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="flex items-center gap-1.5 text-red-400 px-2 h-6 hover:bg-white/5 rounded-md transition-colors"
                  >
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      className="flex items-center justify-center w-4 h-4 drop-shadow-[0_0_6px_rgba(248,113,113,0.5)]"
                    >
                      <Loader2 className="w-3 h-3" />
                    </motion.div>
                    <span className="text-[9px] font-medium">
                      {contextIndicatorCopy.switching}
                    </span>
                  </motion.div>
                ) : contextIndicatorKind === 'compressing' ? (
                  <motion.div
                    key="compressing"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="flex items-center gap-1.5 px-2 h-6 hover:bg-white/5 rounded-md cursor-pointer transition-colors"
                  >
                    <motion.div
                      className="flex items-center justify-center w-4 h-4 drop-shadow-[0_0_6px_rgba(var(--accent-rgb),0.5)]"
                      animate={{ scale: [1, 1.2, 1], opacity: [1, 0.7, 1] }}
                      transition={{ duration: 0.8, repeat: Infinity }}
                    >
                      <Maximize2 className="w-3 h-3 text-accent" />
                    </motion.div>
                    <span className="text-[9px] font-medium text-accent">
                      {contextIndicatorCopy.compressing}
                    </span>
                  </motion.div>
                ) : contextIndicatorKind === 'handoff_ready' ? (
                  <motion.div
                    key="handoff-ready"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="flex items-center gap-1.5 text-amber-400 px-2 h-6 hover:bg-white/5 rounded-md transition-colors"
                  >
                    <div className="flex items-center justify-center w-4 h-4 drop-shadow-[0_0_6px_rgba(251,191,36,0.45)]">
                      <ScrollText className="w-3 h-3" />
                    </div>
                    <span className="text-[9px] font-medium">
                      {contextIndicatorCopy.handoffReady}
                    </span>
                  </motion.div>
                ) : contextIndicatorKind === 'switched' ? (
                  <motion.div
                    key="switched"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="flex items-center gap-1.5 text-emerald-400 px-2 h-6 hover:bg-white/5 rounded-md transition-colors"
                  >
                    <div className="flex items-center justify-center w-4 h-4 drop-shadow-[0_0_6px_rgba(52,211,153,0.45)]">
                      <CheckCircle2 className="w-3 h-3" />
                    </div>
                    <span className="text-[9px] font-medium">
                      {contextIndicatorCopy.switched}
                    </span>
                  </motion.div>
                ) : (
                  <motion.div
                    key="normal"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center justify-center px-1.5 py-1 rounded-md hover:bg-white/5 transition-colors cursor-pointer group h-6"
                  >
                    <div className="flex items-center gap-1.5">
                      <div className="flex items-center justify-center transition-all duration-300 w-4 h-4">
                        <Maximize2 className={`w-3 h-3 transition-colors ${layerColorClass}`} />
                      </div>
                      <span className="text-[9px] font-bold font-mono text-text-muted group-hover:text-text-primary transition-colors">
                        {peakContextUsage !== null ? `${Math.round(peakContextUsage * 100)}%` : '--'}
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            }
            width={340}
            height={480}
            language={language as 'en' | 'zh'}
          >
            <ContextStatsContent
              totalUsage={tokenStats.totalUsage}
              lastUsage={tokenStats.lastUsage}
              language={language as 'en' | 'zh'}
            />
          </BottomBarPopover>

          {messageCount > 0 && (
            <div
              className="flex items-center justify-center w-7 h-7 rounded-md cursor-default group hover:bg-white/5 transition-colors"
              title={language === 'zh' ? `${messageCount} 条消息` : `${messageCount} messages`}
            >
              <div className="relative flex items-center justify-center w-4 h-4 transition-colors">
                <MessageSquare className="w-3 h-3 text-blue-400 drop-shadow-[0_0_6px_rgba(96,165,250,0.5)] transition-colors" />
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-blue-400 shadow-[0_0_6px_currentColor] rounded-full" />
              </div>
            </div>
          )}

          {plans.length > 0 && (
            <BottomBarPopover
              icon={
                <div className="group flex items-center justify-center w-6 h-6 rounded-md hover:bg-white/5 transition-colors">
                  <div className="relative flex items-center justify-center w-4 h-4 transition-colors">
                    <ListTodo className={`w-3 h-3 transition-colors ${executingPlansCount > 0 ? 'text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.6)]' : 'text-text-muted group-hover:text-text-primary'}`} />
                    {executingPlansCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse shadow-[0_0_4px_rgba(251,191,36,0.5)] border border-background-secondary" />
                    )}
                  </div>
                </div>
              }
              tooltip={language === 'zh' ? '任务计划' : 'Task Plans'}
              title={language === 'zh' ? '任务计划' : 'Task Plans'}
              width={340}
              height={360}
              language={language as 'en' | 'zh'}
            >
              <PlanListContent language={language as 'en' | 'zh'} />
            </BottomBarPopover>
          )}

          <BottomBarPopover
            icon={
              <div className="group flex items-center justify-center w-6 h-6 rounded-md hover:bg-white/5 transition-colors">
                <div className="relative flex items-center justify-center w-4 h-4 transition-colors">
                  <ScrollText className={`w-3 h-3 transition-colors ${currentThreadToolCallCount > 0 ? 'text-blue-400 drop-shadow-[0_0_6px_rgba(96,165,250,0.6)]' : 'text-text-muted group-hover:text-text-primary'}`} />
                  {currentThreadToolCallCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-blue-400 shadow-[0_0_8px_currentColor] rounded-full" />
                  )}
                </div>
              </div>
            }
            width={380}
            height={280}
            language={language as 'en' | 'zh'}
          >
            <ToolCallLogContent language={language as 'en' | 'zh'} />
          </BottomBarPopover>

          <LocalServersIndicator language={language as 'en' | 'zh'} />
        </div>

        <div className="flex items-center gap-0.5 h-full">
          <button
            onClick={() => setTerminalVisible(!terminalVisible)}
            className="group flex items-center justify-center w-7 h-7 rounded-md transition-all"
            title="Toggle Terminal"
          >
            <div className={`flex items-center justify-center w-5 h-5 rounded-md transition-colors ${terminalVisible ? 'text-accent drop-shadow-[0_0_6px_rgba(var(--accent-rgb),0.5)]' : 'text-text-muted hover:bg-white/5 hover:text-text-primary'}`}>
              <Terminal className="w-3 h-3" />
            </div>
          </button>
          <button
            onClick={() => setDebugVisible(!debugVisible)}
            className="group flex items-center justify-center w-7 h-7 rounded-md transition-all"
            title="Toggle Debug"
          >
            <div className={`flex items-center justify-center w-5 h-5 rounded-md transition-colors ${debugVisible ? 'text-accent drop-shadow-[0_0_6px_rgba(var(--accent-rgb),0.5)]' : 'text-text-muted hover:bg-white/5 hover:text-text-primary'}`}>
              <Bug className="w-3 h-3" />
            </div>
          </button>
        </div>

        <div className="flex items-center h-full pr-1">
          <BottomBarPopover
            icon={
              <div className={`group relative flex items-center h-6 rounded-md transition-all ease-out duration-500 overflow-hidden ${activeToast && !shouldEject ? 'bg-transparent px-1 max-w-[320px]' : 'justify-center w-6 hover:bg-white/5'}`}>
                <AnimatePresence mode="wait">
                  {activeToast && !shouldEject ? (
                    <motion.div
                      layoutId="adnify-dynamic-island"
                      key={activeToast.id}
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      className="flex items-center gap-1.5 whitespace-nowrap pl-1"
                    >
                      <Volume2 className={`w-3.5 h-3.5 animate-pulse shrink-0 ${
                        activeToast.type === 'success' ? 'text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.6)]' :
                          activeToast.type === 'error' ? 'text-red-400 drop-shadow-[0_0_6px_rgba(248,113,113,0.6)]' :
                            activeToast.type === 'warning' ? 'text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.6)]' :
                              'text-blue-400 drop-shadow-[0_0_6px_rgba(96,165,250,0.6)]'
                      }`} />
                      <span className="text-[10.5px] text-text-primary font-medium truncate max-w-[260px]">
                        {activeToast.message}
                      </span>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="bell"
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      className="relative flex items-center justify-center w-4 h-4 transition-colors"
                    >
                      <Bell className={`w-3 h-3 ${notificationCount > 0 ? 'text-blue-400 drop-shadow-[0_0_6px_rgba(96,165,250,0.6)]' : 'text-text-muted group-hover:text-text-primary'}`} />
                      {notificationCount > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-blue-400 shadow-[0_0_8px_currentColor] rounded-full" />
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            }
            width={360}
            height={420}
            language={language as 'en' | 'zh'}
          >
            <NotificationCenterContent language={language as 'en' | 'zh'} />
          </BottomBarPopover>
        </div>
      </div>
    </div>
  )
}
