import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useEffect, useMemo, useState } from 'react'
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
  selectCompressionStats,
  selectContextIndicatorKind,
} from '@renderer/agent/store/AgentStore'
import { isAssistantMessage, type TokenUsage } from '@renderer/agent/types'
import { useDiagnosticsStore, getFileStats } from '@services/diagnosticsStore'
import LspStatusIndicator from './LspStatusIndicator'
import { EmotionStatusIndicator } from '../agent/EmotionStatusIndicator'
import { motion, AnimatePresence } from 'framer-motion'

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
    setActiveSidePanel: s.setActiveSidePanel,
  })))

  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null)
  const [workerProgress, setWorkerProgress] = useState<IndexProgress | null>(null)

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
        lastUsage = msg.usage
      }
    }

    return { totalUsage, lastUsage }
  }, [messageCount])

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
  const plans = useAgentStore(state => state.plans)
  const activePlanId = useAgentStore(state => state.activePlanId)
  const loadPlansFromDisk = useAgentStore(state => state.loadPlansFromDisk)

  useEffect(() => {
    if (workspacePath) {
      loadPlansFromDisk(workspacePath)
    }
  }, [workspacePath, loadPlansFromDisk])

  const executingPlansCount = plans.filter(plan => plan.status === 'executing').length

  const layerColorClass =
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

  return (
    <div className="h-8 bg-background-secondary/40 backdrop-blur-md flex items-center justify-between px-3 text-[10px] select-none text-text-muted z-50 font-medium border-t border-border/30 shadow-[0_-1px_15px_rgba(0,0,0,0.03)]">
      <div className="flex items-center gap-3">
        <EmotionStatusIndicator />

        {isGitRepo && gitStatus && (
          <button className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/5 text-text-muted hover:text-text-primary transition-colors group">
            <div className="flex items-center justify-center w-4 h-4 transition-colors">
              <GitBranch className="w-3 h-3 text-text-muted group-hover:text-text-primary transition-colors" />
            </div>
            <span className="font-medium tracking-wide group-hover:text-text-primary">{gitStatus.branch}</span>
          </button>
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
                        {compressionStats ? `${(compressionStats.ratio * 100).toFixed(1)}%` : '0%'}
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
            <div className="flex items-center gap-1.5 px-2 py-1 h-6 rounded-md cursor-default group hover:bg-white/5 transition-colors">
              <div className="flex items-center justify-center w-4 h-4 transition-colors">
                <MessageSquare className="w-3 h-3 text-text-muted group-hover:text-text-primary transition-colors" />
              </div>
              <span className="font-medium text-text-muted group-hover:text-text-primary transition-colors">{messageCount}</span>
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
              badge={activePlanId ? undefined : plans.length}
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
                  <ScrollText className={`w-3 h-3 transition-colors ${toolCallLogs.length > 0 ? 'text-blue-400 drop-shadow-[0_0_6px_rgba(96,165,250,0.6)]' : 'text-text-muted group-hover:text-text-primary'}`} />
                  {toolCallLogs.length > 0 && (
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
            badge={undefined}
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
