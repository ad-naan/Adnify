import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { memo, useState, useRef, useEffect, useCallback, useMemo, forwardRef, type ComponentPropsWithoutRef } from 'react'
import { Virtuoso } from 'react-virtuoso'
import {
  AlertTriangle,
  ListTree,
  Plus,
  Trash2,
  Upload,
  ChevronDown,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore, useModeStore } from '@/renderer/store'
import { useShallow } from 'zustand/react/shallow'
import { useAgentActions, useAgentCommands, useAgentViewState } from '@/renderer/hooks/useAgent'
import { useChatScrollController } from '@/renderer/hooks'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { selectTodos } from '@/renderer/agent/store/AgentStore'
import { t, asLanguage } from '@/renderer/i18n'
import { toFullPath, getFileName } from '@shared/utils/pathUtils'
import { getBuiltinProvider } from '@shared/config/providers'
import {
  ChatMessage as ChatMessageType,
  isUserMessage,
  isAssistantMessage,
  getMessageText,
  ContextItem,
  FileContext,
} from '@/renderer/agent/types'

import { ChatInput, PendingImage } from '@/renderer/components/chat'
import MentionPopup from '@/renderer/components/agent/MentionPopup'
import { MentionParser, MentionCandidate } from '@/renderer/agent/utils/MentionParser'
import ChatMessageUI from './ChatMessage'
import UnifiedStatusTray from './UnifiedStatusTray'
import { keybindingService } from '@/renderer/services/keybindingService'
import { slashCommandService, SlashCommand } from '@/renderer/services/slashCommandService'
import SlashCommandPopup from './SlashCommandPopup'
import EmptyChatSuggestions from '../chat/EmptyChatSuggestions'
import { ChatMessagesSkeleton } from '../ui/Loading'
import { Button } from '../ui'
import { globalConfirm } from '../common/ConfirmDialog'
import { useToast } from '@/renderer/components/common/ToastProvider'
import TaskCommandCenter from './TaskCommandCenter'
import ActiveTaskQuickSwitch from './ActiveTaskQuickSwitch'
import { BranchSelector } from './BranchControls'
import { composerService } from '@/renderer/agent/services/composerService'
import { useDecorativeAnimations } from '@/renderer/hooks/useDecorativeAnimations'
import {
  buildChatTimelineProjection,
  type ChatTimelineItem,
  type TimelineArchiveItem,
} from './chatTimelineProjection'
import { useMessageQueueStore } from '@/renderer/agent/store/slices/queueSlice'
import { useMessageQueueConsumer } from '@/renderer/hooks/useMessageQueue'
import { shellServerRoutingService } from '@/renderer/agent/services/shellServerRoutingService'
import PlanWorkbench from '@/renderer/components/plan/workbench/PlanWorkbench'
import { isPlanBoardPath } from '@/shared/types/planBoard'
import { findMostRecentThreadForMode, isTopLevelThreadForMode } from '@/renderer/agent/threads/threadModeProjection'
import type { WorkMode } from '@/shared/types/workMode'
import { findThreadIdForMessage } from '@/renderer/agent/utils/interactiveResponse'
import { supportsTaskApproval } from './ToolCallGroup'
import { deriveThreadTaskStatus, isAgentTaskThread } from './taskCenterProjection'

interface RenderableMessageItem {
  message: ChatMessageType
  hasCheckpoint: boolean
  renderKey: string
}

const MemoizedVirtuoso = memo(Virtuoso) as typeof Virtuoso
const CHAT_TIMELINE_STYLE = {
  minHeight: '100px',
  overflowX: 'hidden',
  overflowY: 'auto',
} as const

function computeTimelineItemKey(
  _index: number,
  item: ChatTimelineItem<RenderableMessageItem>
): string {
  return item.key
}

const HISTORY_REVEAL_BATCH_SIZE = 50
const HISTORY_VISIBLE_TAIL_COUNT = 100

function buildRenderableMessageItems(
  messages: ChatMessageType[],
  checkpointMessageIds: ReadonlySet<string>
): RenderableMessageItem[] {
  return messages.map(message => {
    const hasCheckpoint = isUserMessage(message) && checkpointMessageIds.has(message.id)

    return {
      message,
      hasCheckpoint,
      // Virtuoso caches rows by key. Include checkpoint state so a hydrated checkpoint
      // remounts the affected user row instead of reusing the pre-hydration render.
      renderKey: `${message.id}:${hasCheckpoint ? 'checkpoint' : 'plain'}`,
    }
  })
}

export default function ChatPanel() {
  const decorativeAnimations = useDecorativeAnimations()
  const {
    llmConfig,
    workspacePath,
    openFile,
    setActiveFile,
    language,
    activeFilePath,
    selectedCode,
  } = useStore(useShallow(s => ({
    llmConfig: s.llmConfig,
    workspacePath: s.workspacePath,
    openFile: s.openFile,
    setActiveFile: s.setActiveFile,
    language: s.language,
    activeFilePath: s.activeFilePath,
    selectedCode: s.selectedCode,
  })))

  // 从 AgentStore 获取 inputPrompt
  const inputPrompt = useAgentStore(state => state.inputPrompt)
  const setInputPrompt = useAgentStore(state => state.setInputPrompt)
  const hasActiveThread = useAgentStore(state => {
    if (!state.currentThreadId) return false
    return !!state.threads[state.currentThreadId]
  })
  const activeThreadMessagesHydrated = useAgentStore(state => {
    if (!state.currentThreadId) return true
    const thread = state.threads[state.currentThreadId]
    if (!thread) return true
    // A failed load also ends the skeleton: the messages are not in memory, but
    // waiting longer will not change that, and the thread stays un-hydrated so
    // the persistence layer keeps its hands off the on-disk history.
    if (thread.hydrationFailed) return true
    return thread.messagesHydrated !== false
  })
  const taskAttentionCount = useAgentStore(state => Object.values(state.threads).filter(thread => {
    if (!isAgentTaskThread(thread)) return false
    const status = deriveThreadTaskStatus(thread)
    return status === 'running' || status === 'waiting' || status === 'handoff' || status === 'failed'
  }).length)

  const chatMode = useModeStore(s => s.currentMode)
  const setChatMode = useModeStore(s => s.setMode)
  const contextFilePath = activeFilePath && !isPlanBoardPath(activeFilePath) ? activeFilePath : null

  const toast = useToast()

  // 消息队列自动消费
  useMessageQueueConsumer()

  const {
    messages,
    isStreaming,
    isAwaitingApproval,
    pendingToolCall,
    pendingToolCalls,
    pendingChanges,
    messageCheckpoints,
    contextItems,
    currentThreadId,
    messageListVersion,
  } = useAgentViewState()
  const visibleContextItems = useMemo(() => contextItems.filter(item => !(
    item.type === 'File' && isPlanBoardPath((item as FileContext).uri)
  )), [contextItems])
  const { sendMessage, abort, approveCurrentTool, approveCurrentToolForTask, rejectCurrentTool } = useAgentCommands()
  const canApprovePendingToolForTask = pendingToolCall ? supportsTaskApproval(pendingToolCall) : false
  const {
    createThread,
    clearMessages,
    deleteMessagesAfter,
    acceptAllChanges,
    undoAllChanges,
    acceptChange,
    undoChange,
    restoreToCheckpoint,
    getCheckpointForMessage,
    addContextItem,
    removeContextItem,
    regenerateFromMessage,
    switchThread,
  } = useAgentActions()

  const resolvedModeRef = useRef<WorkMode | null>(null)
  useEffect(() => {
    if (resolvedModeRef.current === chatMode) return
    resolvedModeRef.current = chatMode

    const state = useAgentStore.getState()
    const current = state.currentThreadId ? state.threads[state.currentThreadId] : undefined
    if (isTopLevelThreadForMode(current, chatMode)) return

    const recent = findMostRecentThreadForMode(Object.values(state.threads), chatMode)
    if (recent) switchThread(recent.id)
    else createThread({ mode: chatMode, origin: 'user' })
  }, [chatMode, createThread, switchThread])

  const [inputState, setInputState] = useState('')
  const input = inputState ?? ''
  const setInput = useCallback((value: string | null | undefined) => {
    setInputState(value ?? '')
  }, [])
  const [images, setImages] = useState<PendingImage[]>([])
  const [isOptimizingPrompt, setIsOptimizingPrompt] = useState(false)
  const optimizeRequestRef = useRef<{ requestId: string; cleanup: () => void } | null>(null)
  const [planOverlayOpen, setPlanOverlayOpen] = useState(false)
  const imagesRef = useRef(images)
  imagesRef.current = images
  const checkpointMessageIds = useMemo(() => {
    return new Set(messageCheckpoints.map(checkpoint => checkpoint.messageId))
  }, [messageCheckpoints])

  // 组件卸载时释放所有未发送图片的 ObjectURL
  useEffect(() => {
    return () => {
      imagesRef.current.forEach(img => URL.revokeObjectURL(img.previewUrl))
    }
  }, [])

  // 缓存过滤后的消息列表，避免每次渲染都创建新数组
  const filteredMessages = useMemo(
    () => messages.filter(m => m.role === 'user' || m.role === 'assistant'),
    [messages, messageListVersion]
  )

  // 骨架屏转场状态：避免大量消息的突现造成卡顿
  const [threadHistoryRevealCount, setThreadHistoryRevealCount] = useState<Record<string, number>>({})
  const currentThreadHistoryRevealCount = currentThreadId
    ? (threadHistoryRevealCount[currentThreadId] ?? 0)
    : 0
  const timelineProjection = useMemo(
    () => buildChatTimelineProjection(filteredMessages, {
      expandedHistoryCount: currentThreadHistoryRevealCount,
      visibleTailCount: HISTORY_VISIBLE_TAIL_COUNT,
      revealBatchSize: HISTORY_REVEAL_BATCH_SIZE,
    }),
    [currentThreadHistoryRevealCount, filteredMessages]
  )
  const visibleRenderableMessages = useMemo<RenderableMessageItem[]>(
    () => buildRenderableMessageItems(timelineProjection.visibleMessages, checkpointMessageIds),
    [checkpointMessageIds, timelineProjection.visibleMessages]
  )
  const timelineItems = useMemo<ChatTimelineItem<RenderableMessageItem>[]>(() => {
    const items: ChatTimelineItem<RenderableMessageItem>[] = []

    if (timelineProjection.hiddenCount > 0) {
      items.push({
        kind: 'archive',
        key: `archive:${timelineProjection.hiddenCount}`,
        hiddenCount: timelineProjection.hiddenCount,
        revealCount: timelineProjection.revealCount,
        remainingCount: Math.max(0, timelineProjection.hiddenCount - timelineProjection.revealCount),
      })
    }

    for (const item of visibleRenderableMessages) {
      items.push({
        kind: 'message',
        key: item.renderKey,
        item,
      })
    }

    return items
  }, [timelineProjection.hiddenCount, timelineProjection.revealCount, visibleRenderableMessages])
  const [isSwitchingThread, setIsSwitchingThread] = useState(false)
  const prevThreadIdRef = useRef(currentThreadId)
  const pendingRevealAnchorKeyRef = useRef<string | null>(null)
  const visibleRangeRef = useRef<{ startIndex: number; endIndex: number } | null>(null)
  // Virtuoso 初始滚动位置：只在线程切换时重新指向底部，普通追加消息不重算
  // 避免每次消息列表变化都重新传入新的 initialTopMostItemIndex
  // 导致 Virtuoso 强制跳回该位置（即滚动条回顶的根因）
  const initialIndexRef = useRef(Math.max(0, timelineItems.length - 1))
  // 让上面的切换 effect 能读到最新条目数，而不必把它列为依赖。
  const timelineItemCountRef = useRef(timelineItems.length)
  timelineItemCountRef.current = timelineItems.length

  // Effect 1：只监听 currentThreadId 变化，控制骨架屏的显示/隐藏
  //
  // 依赖里绝对不能出现随消息变化的值。骨架屏靠一个 16ms 定时器关闭，而任何
  // 额外依赖变化都会先触发 cleanup（clearTimeout）再重新执行；重新执行时
  // threadChanged 已经是 false，于是提前 return，定时器再也不会被装回去，
  // isSwitchingThread 永久停在 true —— 表现为消息面板卡在骨架屏，必须手动
  // 切换线程才能恢复。hydration 完成正好会改变消息数量，所以这个竞态在
  // 「切到未加载的线程」时高频出现。
  useEffect(() => {
    const threadChanged = currentThreadId !== prevThreadIdRef.current
    prevThreadIdRef.current = currentThreadId

    if (!threadChanged) return

    // 线程切换时同步更新初始位置索引，指向新线程的底部
    initialIndexRef.current = Math.max(0, timelineItemCountRef.current - 1)

    // 线程切换：已加载线程只保留一帧过渡，未加载线程继续由 hydration 骨架接管
    setIsSwitchingThread(true)
    const timer = window.setTimeout(() => {
      requestAnimationFrame(() => {
        setIsSwitchingThread(false)
      })
    }, 16)
    return () => window.clearTimeout(timer)
  }, [currentThreadId])

  // Unified Sidebar State
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<'history' | 'branches'>('history')

  useEffect(() => {
    if (chatMode === 'plan') setSidebarOpen(false)
  }, [chatMode])

  const [showFileMention, setShowFileMention] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionPosition, setMentionPosition] = useState({ x: 0, y: 0 })
  const [mentionCandidates, setMentionCandidates] = useState<MentionCandidate[]>([])
  const [mentionLoading, setMentionLoading] = useState(false)
  const [mentionRange, setMentionRange] = useState<{ start: number; end: number } | null>(null)
  const suggestionRequestId = useRef(0) // 防止 getSuggestions 竞态
  const [isDragging, setIsDragging] = useState(false)
  // 斜杠命令状态
  const [showSlashCommand, setShowSlashCommand] = useState(false)
  const [slashCommandQuery, setSlashCommandQuery] = useState('')

  // Task List 状态
  const todos = useAgentStore(selectTodos)

  // 监听选项卡片选择事件
  useEffect(() => {
    const handleOptionSelect = (event: CustomEvent<{ content: string; messageId: string }>) => {
      const { content, messageId } = event.detail
      if (content) {
        const state = useAgentStore.getState()
        const threadId = findThreadIdForMessage(state.threads, messageId)
        void sendMessage(content, threadId ? { threadId } : undefined)
      }
    }

    const handleUpdateInteractive = (event: CustomEvent<{ messageId: string; selectedIds: string[]; customText?: string }>) => {
      const { messageId, selectedIds, customText } = event.detail
      // 更新消息的 interactive.selectedIds
      const store = useAgentStore.getState()
      const threadId = findThreadIdForMessage(store.threads, messageId)
      const thread = threadId ? store.threads[threadId] : undefined
      if (thread) {
        const msg = thread.messages.find(m => m.id === messageId)
        if (msg && msg.role === 'assistant' && (msg as any).interactive) {
          store.forThread(thread.id).updateMessage(messageId, {
            interactive: {
              ...(msg as any).interactive,
              selectedIds,
              customResponse: customText?.trim() || undefined,
              answeredAt: Date.now(),
            },
          } as any)
        }
      }
    }

    window.addEventListener('chat-send-message', handleOptionSelect as EventListener)
    window.addEventListener('chat-update-interactive', handleUpdateInteractive as EventListener)
    return () => {
      window.removeEventListener('chat-send-message', handleOptionSelect as EventListener)
      window.removeEventListener('chat-update-interactive', handleUpdateInteractive as EventListener)
    }
  }, [sendMessage])

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputContainerRef = useRef<HTMLDivElement>(null)

  // 用于防止工具卡片展开/收缩时误判滚动状态
  const isHydratingActiveThread = hasActiveThread && !activeThreadMessagesHydrated
  const {
    atBottomThreshold,
    attachScrollerNode,
    followOutput,
    handleBottomStateChange,
    handleTotalListHeightChanged,
    handleVisibleRangeChanged,
    scrollToBottom,
    showScrollButton,
    virtuosoRef,
  } = useChatScrollController({
    isHydratingActiveThread,
    isStreaming,
    isSwitchingThread,
    messageCount: timelineItems.length,
    threadId: currentThreadId,
  })

  const revealArchivedMessages = useCallback(() => {
    if (!currentThreadId || timelineProjection.revealCount <= 0) {
      return
    }

    const anchorIndex = visibleRangeRef.current?.startIndex ?? 0
    const anchorItem = timelineItems[anchorIndex]
    if (anchorItem?.kind === 'message') {
      pendingRevealAnchorKeyRef.current = anchorItem.key
    } else {
      const firstVisibleMessage = timelineItems.find(item => item.kind === 'message')
      pendingRevealAnchorKeyRef.current = firstVisibleMessage?.key ?? null
    }

    setThreadHistoryRevealCount(state => ({
      ...state,
      [currentThreadId]: (state[currentThreadId] ?? 0) + timelineProjection.revealCount,
    }))
  }, [currentThreadId, timelineItems, timelineProjection.revealCount])

  useEffect(() => {
    const anchorKey = pendingRevealAnchorKeyRef.current
    if (!anchorKey) {
      return
    }

    const anchorIndex = timelineItems.findIndex(item => item.key === anchorKey)
    if (anchorIndex < 0) {
      return
    }

    pendingRevealAnchorKeyRef.current = null
    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({
        index: anchorIndex,
        align: 'start',
        behavior: 'auto',
      })
    })
  }, [timelineItems, virtuosoRef])

  // 一次性同步 inputPrompt 到本地 input
  useEffect(() => {
    if (inputPrompt) {
      setInput(inputPrompt)
      setInputPrompt('')
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }, [inputPrompt, setInputPrompt, textareaRef])

  useEffect(() => () => {
    const activeRequest = optimizeRequestRef.current
    if (!activeRequest) return
    activeRequest.cleanup()
    api.llm.abort(activeRequest.requestId)
    optimizeRequestRef.current = null
  }, [])

  const handleOptimizePrompt = useCallback(async () => {
    const draft = input.trim()
    if (!draft || isOptimizingPrompt || isStreaming) return

    const requestId = crypto.randomUUID()
    let optimizedPrompt = ''
    let settled = false
    let unsubscribeStream = () => {}
    let unsubscribeDone = () => {}
    let unsubscribeError = () => {}

    const cleanup = () => {
      unsubscribeStream()
      unsubscribeDone()
      unsubscribeError()
      if (optimizeRequestRef.current?.requestId === requestId) {
        optimizeRequestRef.current = null
      }
    }
    const finish = () => {
      if (settled) return false
      settled = true
      cleanup()
      setIsOptimizingPrompt(false)
      return true
    }

    setIsOptimizingPrompt(true)
    unsubscribeStream = api.llm.onStream(requestId, chunk => {
      if (chunk.type === 'text' && chunk.content) optimizedPrompt += chunk.content
    })
    unsubscribeDone = api.llm.onDone(requestId, () => {
      if (!finish()) return
      const result = optimizedPrompt.trim()
      if (!result) {
        toast.error(t('chatPanel.couldNotImprovePrompt', asLanguage(language)), t('chatPanel.theModelReturnedNo', asLanguage(language)))
        return
      }
      setInput(result)
      requestAnimationFrame(() => textareaRef.current?.focus())
      toast.success(t('chatPanel.promptImproved', asLanguage(language)))
    })
    unsubscribeError = api.llm.onError(requestId, error => {
      if (!finish()) return
      toast.error(t('chatPanel.couldNotImprovePrompt', asLanguage(language)), error.message)
    })
    optimizeRequestRef.current = { requestId, cleanup }

    try {
      await api.llm.send({
        config: llmConfig,
        messages: [{ role: 'user', content: draft }],
        systemPrompt: t('chatPanel.youAreAPrompt', asLanguage(language)),
        requestId,
      })
    } catch (error) {
      if (!finish()) return
      const message = error instanceof Error ? error.message : String(error)
      logger.ui.error('[ChatPanel] Prompt optimization failed:', error)
      toast.error(t('chatPanel.couldNotImprovePrompt', asLanguage(language)), message)
    }
  }, [input, isOptimizingPrompt, isStreaming, language, llmConfig, setInput, textareaRef, toast])


  // 处理显示 diff
  const handleShowDiff = useCallback(async (filePath: string, oldContent: string, newContent: string) => {
    const fullPath = toFullPath(filePath, workspacePath)
    const currentContent = await api.file.readFull(fullPath)
    if (currentContent !== null) {
      openFile(fullPath, currentContent)
      setActiveFile(fullPath)
    }

    // 打开虚拟 Diff 标签页
    const diffUri = `diff://${fullPath}`
    openFile(diffUri, newContent, oldContent)
    setActiveFile(diffUri)
  }, [workspacePath, openFile, setActiveFile])

  // 图片处理
  const addImage = useCallback(async (file: File) => {
    const id = crypto.randomUUID()
    const previewUrl = URL.createObjectURL(file)

    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      setImages(prev => prev.map(img => (img.id === id ? { ...img, base64 } : img)))
    }
    reader.readAsDataURL(file)

    setImages(prev => [...prev, { id, file, previewUrl }])
  }, [])

  // 粘贴处理
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) addImage(file)
      }
    }
  }, [addImage])

  // 拖放处理
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
      setIsDragging(false)
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    // 图片扩展名
    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg']

    // 辅助函数：检测路径是否是文件夹
    const checkIsDirectory = async (path: string): Promise<boolean> => {
      try {
        const stats = await api.file.stat(path)
        return stats?.isDirectory === true
      } catch {
        return false
      }
    }

    // 辅助函数：检测是否是图片文件
    const isImageFile = (path: string): boolean => {
      const ext = path.split('.').pop()?.toLowerCase() || ''
      return imageExtensions.includes(ext)
    }

    // 辅助函数：将文件路径转换为图片并添加
    const addImageFromPath = async (path: string) => {
      try {
        const base64 = await api.file.readBinary(path)
        if (base64) {
          const ext = path.split('.').pop()?.toLowerCase() || 'png'
          const mimeTypes: Record<string, string> = {
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            gif: 'image/gif',
            webp: 'image/webp',
            svg: 'image/svg+xml',
            bmp: 'image/bmp',
            ico: 'image/x-icon',
          }
          const mimeType = mimeTypes[ext] || 'image/png'
          const dataUrl = `data:${mimeType};base64,${base64}`
          const fileName = path.split(/[/\\]/).pop() || 'image'
          const id = crypto.randomUUID()
          // 直接添加到 images 状态
          setImages(prev => [...prev, {
            id,
            file: new File([], fileName, { type: mimeType }),
            previewUrl: dataUrl,
            base64
          }])
          return true
        }
      } catch (err) {
        console.error('Failed to load image:', err)
      }
      return false
    }

    // 获取拖放的文件
    const files = Array.from(e.dataTransfer.files)

    if (files.length > 0) {
      // 有原生文件对象（外部文件拖入）
      const imageFiles = files.filter(f => f.type.startsWith('image/'))
      if (imageFiles.length > 0) {
        imageFiles.forEach(addImage)
        return
      }

      for (const file of files) {
        const filePath = (file as any).path
        if (filePath) {
          // 检查是否是图片文件
          if (isImageFile(filePath)) {
            await addImageFromPath(filePath)
            continue
          }

          const exists = contextItems.some((s: ContextItem) =>
            (s.type === 'File' && (s as FileContext).uri === filePath) ||
            (s.type === 'Folder' && (s as any).uri === filePath)
          )
          if (!exists) {
            const isDir = await checkIsDirectory(filePath)
            if (isDir) {
              addContextItem({ type: 'Folder', uri: filePath })
            } else {
              addContextItem({ type: 'File', uri: filePath })
            }
          }
        }
      }
      return
    }

    // 没有原生文件，尝试从自定义数据中获取路径
    const items = e.dataTransfer.items
    if (!items || items.length === 0) {
      return
    }

    // 尝试获取 adnify 自定义路径
    let filePath: string | null = null

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.kind === 'string') {
        if (item.type === 'application/adnify-file-path') {
          filePath = await new Promise<string>((resolve) => {
            item.getAsString((s) => resolve(s))
          })
          break
        } else if (item.type === 'text/uri-list' && !filePath) {
          const uriList = await new Promise<string>((resolve) => {
            item.getAsString((s) => resolve(s))
          })
          const match = uriList.match(/file:\/\/\/(.+)/)
          if (match) {
            filePath = decodeURIComponent(match[1])
          }
        }
      }
    }

    if (filePath) {
      // 检查是否是图片文件
      if (isImageFile(filePath)) {
        await addImageFromPath(filePath)
        return
      }

      const exists = contextItems.some((s: ContextItem) =>
        (s.type === 'File' && (s as FileContext).uri === filePath) ||
        (s.type === 'Folder' && (s as any).uri === filePath)
      )
      if (!exists) {
        const isDir = await checkIsDirectory(filePath)
        if (isDir) {
          addContextItem({ type: 'Folder', uri: filePath })
        } else {
          addContextItem({ type: 'File', uri: filePath })
        }
      }
    }
  }, [addImage, contextItems, addContextItem, setImages])

  // 输入变化处理
  const handleInputChange = useCallback(async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    const cursorPos = e.target.selectionStart || 0
    setInput(value)

    // 计算弹窗位置
    const updatePopupPosition = () => {
      if (inputContainerRef.current) {
        const rect = inputContainerRef.current.getBoundingClientRect()
        setMentionPosition({ x: rect.left + 16, y: rect.top })
      }
    }

    const parseResult = MentionParser.parse(value, cursorPos)

    if (parseResult) {
      setMentionQuery(parseResult.query)
      setMentionRange(parseResult.range)
      updatePopupPosition()
      setShowFileMention(true)
      setShowSlashCommand(false)

      // Fetch suggestions（用递增 ID 防止竞态：只接受最新请求的结果）
      const requestId = ++suggestionRequestId.current
      setMentionLoading(true)
      try {
        const suggestions = await MentionParser.getSuggestions(parseResult.query, workspacePath, { trigger: parseResult.trigger })
        if (requestId === suggestionRequestId.current) {
          setMentionCandidates(suggestions)
        }
      } catch (err) {
        logger.agent.error('Error fetching suggestions:', err)
      } finally {
        if (requestId === suggestionRequestId.current) {
          setMentionLoading(false)
        }
      }
    } else if (value.startsWith('/') && !value.includes(' ') && value.length < 20) {
      // 斜杠命令：只在行首输入 / 且没有空格时触发
      setSlashCommandQuery(value)
      updatePopupPosition()
      setShowSlashCommand(true)
      setShowFileMention(false)
      setMentionQuery('')
    } else {
      setShowFileMention(false)
      setShowSlashCommand(false)
      setMentionQuery('')
      setSlashCommandQuery('')
    }
  }, [workspacePath])

  // 上下文选择
  const handleSelectMention = useCallback((candidate: MentionCandidate) => {
    if (!mentionRange) return
    const currentInput = input ?? ''

    const textBeforeMention = currentInput.slice(0, mentionRange.start)
    const textAfterMention = currentInput.slice(mentionRange.end)

    let replacement = ''
    let contextItem: ContextItem | null = null

    switch (candidate.type) {
      case 'codebase':
        replacement = '@codebase '
        contextItem = { type: 'Codebase' }
        break
      case 'git':
        replacement = '@git '
        contextItem = { type: 'Git' }
        break
      case 'terminal':
        replacement = '@terminal '
        contextItem = { type: 'Terminal' }
        break
      case 'symbols':
        replacement = '@symbols '
        contextItem = { type: 'Symbols' }
        break
      case 'skill':
        replacement = `@${candidate.data.skillId} `
        contextItem = {
          type: 'Skill',
          skillId: candidate.data.skillId,
          name: candidate.data.name
        }
        break
      case 'file':
      case 'folder':
        replacement = `@${candidate.description || candidate.label} `
        contextItem = {
          type: candidate.type === 'folder' ? 'Folder' : 'File',
          uri: candidate.data.path
        }
        break
      case 'web':
        replacement = '@web '
        contextItem = { type: 'Web' }
        break
      case 'server':
        replacement = `#${candidate.data.serverName}# `
        contextItem = {
          type: 'ShellServer',
          serverLinkId: candidate.data.serverLinkId,
          serverName: candidate.data.serverName,
          host: candidate.data.host,
          port: candidate.data.port,
          username: candidate.data.username,
          remotePath: candidate.data.remotePath,
          bindingMode: 'explicit',
        }
        break
    }

    const newInput = textBeforeMention + replacement + textAfterMention
    setInput(newInput)

    if (contextItem) {
      // Check if exists
      const exists = contextItems.some(item => {
        if (item.type !== contextItem!.type) return false
        if (item.type === 'File' && contextItem!.type === 'File') {
          return (item as FileContext).uri === (contextItem as FileContext).uri
        }
        if (item.type === 'ShellServer' && contextItem!.type === 'ShellServer') {
          return item.serverLinkId === contextItem.serverLinkId
        }
        return true
      })

      if (!exists) {
        addContextItem(contextItem)
      }
    }

    setShowFileMention(false)
    setMentionQuery('')
    textareaRef.current?.focus()
  }, [input, mentionRange, contextItems, addContextItem])

  // 提交
  const handleSubmit = useCallback(async () => {
    if (!input.trim() && images.length === 0) return

    const explicitServer = await shellServerRoutingService.buildExplicitShellServerContext(input)
    if (explicitServer.error) {
      toast.error(explicitServer.error)
      return
    }

    let userMessage: string | Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }> = input.trim()
    let effectiveMode = chatMode

    if (images.length > 0) {
      const readyImages = images.filter(img => img.base64)
      if (readyImages.length !== images.length) return

      userMessage = [
        { type: 'text' as const, text: input.trim() },
        ...readyImages.map(img => ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: img.file.type,
            data: img.base64!,
          },
        })),
      ]
    }

    // 检查是否是斜杠命令
    if (input.startsWith('/')) {
      const result = slashCommandService.parse(input, {
        activeFilePath: contextFilePath || undefined,
        selectedCode: selectedCode || undefined,
        workspacePath: workspacePath || undefined,
      })
      if (result) {
        userMessage = result.prompt
        if (result.mode) {
          effectiveMode = result.mode
          setChatMode(result.mode)
        }
      }
    }

    setInput('')
    setImages((prev) => { prev.forEach((img) => URL.revokeObjectURL(img.previewUrl)); return [] })

    const contextItemsForSend = explicitServer.contextItem
      ? [
        ...visibleContextItems.filter(item => item.type !== 'ShellServer'),
        explicitServer.contextItem,
      ]
      : visibleContextItems.filter(item => item.type !== 'ShellServer')

    const threadState = useAgentStore.getState()
    const currentTarget = currentThreadId ? threadState.threads[currentThreadId] : undefined
    let targetThreadId = isTopLevelThreadForMode(currentTarget, effectiveMode) ? currentThreadId : null
    if (!targetThreadId) {
      targetThreadId = findMostRecentThreadForMode(Object.values(threadState.threads), effectiveMode)?.id
        || createThread({ mode: effectiveMode, origin: 'user' })
    }

    if (targetThreadId) {
      if (explicitServer.lastActiveServer) {
        useAgentStore.getState().setLastActiveServer(explicitServer.lastActiveServer, targetThreadId)
      }
    }

    // 如果正在执行中，将消息加入队列而不是直接发送
    if (isStreaming) {
      const enqueue = useMessageQueueStore.getState().enqueue
      enqueue({
        content: userMessage,
        contextItems: [...contextItemsForSend],
        chatMode: effectiveMode,
        targetThreadId,
      })
      toast.info(t('chatPanel.addedToSendQueue', asLanguage(language)))
      return
    }

    const sendPromise = sendMessage(userMessage, {
      mode: effectiveMode,
      threadId: targetThreadId,
      contextItems: contextItemsForSend,
    })
    requestAnimationFrame(() => scrollToBottom('auto'))
    await sendPromise
  }, [input, images, isStreaming, sendMessage, contextFilePath, selectedCode, workspacePath, setChatMode, scrollToBottom, visibleContextItems, chatMode, toast, language, currentThreadId, createThread])

  // 编辑消息
  const handleEditMessage = useCallback(async (messageId: string, content: string) => {
    if (!content.trim()) return
    deleteMessagesAfter(messageId)
    await sendMessage(content.trim())
  }, [deleteMessagesAfter, sendMessage])

  // 重新生成（创建分支）
  const handleRegenerate = useCallback(async (messageId: string) => {
    // 使用分支功能重新生成
    const result = regenerateFromMessage(messageId)

    if (result) {
      // 成功创建分支，发送消息重新生成
      toast.success(t('chatPanel.branchCreated', asLanguage(language)))
      await sendMessage(result.messageContent)
    } else {
      // 回退到原来的逻辑（直接删除并重新发送）
      const msgIndex = messages.findIndex((m: ChatMessageType) => m.id === messageId)
      if (msgIndex <= 0) return

      let userMsgIndex = msgIndex - 1
      while (userMsgIndex >= 0 && messages[userMsgIndex].role !== 'user') {
        userMsgIndex--
      }

      if (userMsgIndex < 0) return
      const userMsg = messages[userMsgIndex]
      if (!isUserMessage(userMsg)) return

      // 找到用户消息的前一条消息，删除它之后的所有消息（包括用户消息本身）
      if (userMsgIndex > 0) {
        const prevMsg = messages[userMsgIndex - 1]
        deleteMessagesAfter(prevMsg.id)
      } else {
        // 如果用户消息是第一条，清空所有消息
        clearMessages()
      }

      await sendMessage(userMsg.content)
    }
  }, [messages, deleteMessagesAfter, clearMessages, sendMessage, regenerateFromMessage, toast, language])

  // 添加当前文件
  const handleAddCurrentFile = useCallback(() => {
    if (!contextFilePath) return
    const exists = visibleContextItems.some((s: ContextItem) => s.type === 'File' && (s as FileContext).uri === contextFilePath)
    if (exists) return
    addContextItem({ type: 'File', uri: contextFilePath })
  }, [contextFilePath, visibleContextItems, addContextItem])

  // 处理斜杠命令选择
  const handleSlashCommand = useCallback((cmd: SlashCommand) => {
    const result = slashCommandService.parse('/' + cmd.name, {
      activeFilePath: contextFilePath || undefined,
      selectedCode: selectedCode || undefined,
      workspacePath: workspacePath || undefined,
    })
    if (result) {
      setInput(result.prompt)
      if (result.mode) {
        setChatMode(result.mode as any)
      }
    }
    setShowSlashCommand(false)
    setSlashCommandQuery('')
    textareaRef.current?.focus()
  }, [contextFilePath, selectedCode, workspacePath, setChatMode])

  // 键盘处理
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // 忽略 IME 组合状态中的按键（如中文输入法确认拼音）
    if (e.nativeEvent.isComposing) return

    if (showFileMention) {
      if (keybindingService.matches(e, 'list.cancel')) {
        e.preventDefault()
        setShowFileMention(false)
        setMentionQuery('')
      }
      if (['Enter', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.key)) {
        e.preventDefault()
        return
      }
    }

    if (keybindingService.matches(e, 'chat.send')) {
      e.preventDefault()
      handleSubmit()
    }
  }, [showFileMention, handleSubmit])

  const [oauthSignedIn, setOauthSignedIn] = useState(false)
  useEffect(() => {
    window.electronAPI?.credentialsOAuthStatus?.()
      .then(s => setOauthSignedIn(s?.loggedIn ?? false))
      .catch(() => setOauthSignedIn(false))
  }, [])

  const isOAuth = getBuiltinProvider(llmConfig.provider)?.auth.type === 'oauth'
  const hasApiKey = isOAuth ? oauthSignedIn : !!llmConfig.apiKey

  // 处理回退到检查点
  const handleRestore = useCallback(async (messageId: string) => {
    const checkpoint = getCheckpointForMessage(messageId)
    if (!checkpoint) {
      toast.error('No checkpoint found for this message')
      return
    }

    // 找到对应的用户消息内容
    const userMessage = messages.find(m => m.id === messageId)
    const userContent = userMessage && isUserMessage(userMessage)
      ? (typeof userMessage.content === 'string' ? userMessage.content : getMessageText(userMessage.content))
      : ''

    const confirmed = await globalConfirm({
      title: t('chatPanel.restoreCheckpoint', asLanguage(language)),
      message: t('confirmRestoreCheckpoint', language),
      confirmText: t('chatPanel.restore', asLanguage(language)),
      variant: 'warning',
    })
    if (!confirmed) return

    const result = await restoreToCheckpoint(checkpoint.id)
    if (result.success) {
      toast.success(`Restored ${result.restoredFiles.length} file(s)`)

      // 恢复用户消息文本到输入框
      if (userContent) {
        setInput(userContent)
      }

      // 恢复图片到输入框
      if (result.images && result.images.length > 0) {
        const restoredImages: PendingImage[] = result.images.map(img => {
          // 从 base64 创建 Blob 和预览 URL
          const byteCharacters = atob(img.base64)
          const byteNumbers = new Array(byteCharacters.length)
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i)
          }
          const byteArray = new Uint8Array(byteNumbers)
          const blob = new Blob([byteArray], { type: img.mimeType })
          const file = new File([blob], `restored-${img.id}.${img.mimeType.split('/')[1] || 'png'}`, { type: img.mimeType })
          const previewUrl = URL.createObjectURL(blob)

          return {
            id: img.id,
            file,
            previewUrl,
            base64: img.base64,
          }
        })
        setImages(restoredImages)
      }

      // 恢复上下文引用
      if (result.contextItems && result.contextItems.length > 0) {
        for (const item of result.contextItems) {
          addContextItem(item)
        }
      }
    } else if (result.errors.length > 0) {
      toast.error(`Restore failed: ${result.errors[0]}`)
    }
  }, [getCheckpointForMessage, restoreToCheckpoint, toast, language, messages, addContextItem])

  // AgentStatusBar 回调（提取为 useCallback 避免打破 memo）
  const handleReviewFile = useCallback(async (filePath: string) => {
    const change = pendingChanges.find(c => c.filePath === filePath)
    if (!change) return
    const currentContent = await api.file.readFull(filePath)
    if (currentContent !== null) {
      const diffUri = `diff://${filePath}`
      openFile(diffUri, currentContent, change.snapshot.content || '')
      setActiveFile(diffUri)
    }
  }, [pendingChanges, openFile, setActiveFile])

  const handleAcceptFile = useCallback(async (filePath: string) => {
    acceptChange(filePath)
    await composerService.acceptChange(filePath)
    toast.success(`Accepted: ${getFileName(filePath)}`)
  }, [acceptChange, toast])

  const handleRejectFile = useCallback(async (filePath: string) => {
    const success = await undoChange(filePath)
    await composerService.rejectChange(filePath)
    if (success) {
      toast.success(`Reverted: ${getFileName(filePath)}`)
    } else {
      toast.error('Failed to revert')
    }
  }, [undoChange, toast])

  const handleUndoAll = useCallback(async () => {
    const result = await undoAllChanges()
    await composerService.rejectAll()
    if (result.success) {
      toast.success(`Reverted ${result.restoredFiles.length} files`)
    } else {
      toast.error(`Failed to revert some files: ${result.errors.join(', ')}`)
    }
  }, [undoAllChanges, toast])

  const handleKeepAll = useCallback(async () => {
    acceptAllChanges()
    await composerService.acceptAll()
    toast.success('All changes accepted')
  }, [acceptAllChanges, toast])

  // 渲染消息
  const renderArchiveItem = useCallback((item: TimelineArchiveItem) => {
    const label = t('chatPanel.showMoreHistory', asLanguage(language))
    const hiddenLabel = t('chatPanel.olderMessagesArchived', asLanguage(language), { hiddenCount: item.hiddenCount })
    const revealLabel = t('chatPanel.revealMore', asLanguage(language), { revealCount: item.revealCount })
    const remainingLabel = item.remainingCount > 0
      ? (t('chatPanel.remaining', asLanguage(language), { remainingCount: item.remainingCount }))
      : undefined

    return (
      <div className="px-4 pb-3 pt-2">
        <div className="mx-auto max-w-3xl rounded-2xl border border-border/60 bg-background/70 px-4 py-3 shadow-sm backdrop-blur-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                {label}
              </div>
              <div className="mt-1 text-sm text-text-secondary">
                {hiddenLabel}
              </div>
              {remainingLabel && (
                <div className="mt-1 text-xs text-text-muted">
                  {remainingLabel}
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={revealArchivedMessages}
              className="shrink-0 rounded-xl border border-border/60 bg-surface/60 px-3 text-xs text-text-primary hover:bg-surface-hover"
            >
              {revealLabel}
            </Button>
          </div>
        </div>
      </div>
    )
  }, [language, revealArchivedMessages])

  const handleApprovePendingTool = useCallback(() => {
    approveCurrentTool(pendingToolCall?.id)
  }, [approveCurrentTool, pendingToolCall?.id])

  const handleApprovePendingToolForTask = useCallback(() => {
    approveCurrentToolForTask(pendingToolCall?.id)
  }, [approveCurrentToolForTask, pendingToolCall?.id])

  const handleRejectPendingTool = useCallback(() => {
    rejectCurrentTool(pendingToolCall?.id)
  }, [pendingToolCall?.id, rejectCurrentTool])

  const renderTimelineItem = useCallback((item: ChatTimelineItem<RenderableMessageItem>) => {
    if (item.kind === 'archive') {
      return renderArchiveItem(item)
    }

    const msg = item.item.message
    if (!isUserMessage(msg) && !isAssistantMessage(msg)) return null

    return (
      <ChatMessageUI
        key={msg.id}
        message={msg}
        onEdit={handleEditMessage}
        onRegenerate={handleRegenerate}
        onRestore={handleRestore}
        onApproveTool={handleApprovePendingTool}
        onApproveToolForTask={canApprovePendingToolForTask ? handleApprovePendingToolForTask : undefined}
        onRejectTool={handleRejectPendingTool}
        onStopTool={abort}
        onOpenDiff={handleShowDiff}
        pendingToolId={pendingToolCall?.id}
        hasCheckpoint={item.item.hasCheckpoint}
        isAwaitingApproval={isAwaitingApproval}
      />
    )
  }, [abort, canApprovePendingToolForTask, handleApprovePendingTool, handleApprovePendingToolForTask, handleEditMessage, handleRegenerate, handleRejectPendingTool, handleRestore, handleShowDiff, isAwaitingApproval, pendingToolCall?.id, renderArchiveItem])

  const renderTimelineItemContent = useCallback((
    _index: number,
    item: ChatTimelineItem<RenderableMessageItem>
  ) => renderTimelineItem(item), [renderTimelineItem])

  const handleTimelineRangeChanged = useCallback((range: { startIndex: number; endIndex: number }) => {
    visibleRangeRef.current = range
    handleVisibleRangeChanged(range)
  }, [handleVisibleRangeChanged])

  const virtuosoComponents = useMemo(() => ({
    Scroller: forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>((props, ref) => (
        <div
        {...props}
        ref={node => {
          attachScrollerNode(node)

          if (typeof ref === 'function') {
            ref(node)
          } else if (ref) {
            ref.current = node
          }
        }}
      />
    )),
    EmptyPlaceholder: () => (
      <div className="flex flex-col h-full w-full bg-background/40 backdrop-blur-3xl relative overflow-hidden">
        {/* Background Ambience — translate/opacity only.
            `scale` here forced the 120px blur to re-rasterize every frame, and
            `mix-blend-screen` forced an extra off-screen pass; together they held
            the GPU at ~27% on integrated graphics. Translation and opacity stay
            on the compositor, so the blurred layer is rasterized once. */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <motion.div
            animate={decorativeAnimations ? {
              opacity: [0.3, 0.5, 0.3],
              x: [0, 20, 0]
            } : undefined}
            transition={decorativeAnimations
              ? { duration: 8, repeat: Infinity, ease: "easeInOut" }
              : undefined}
            style={{ opacity: 0.4, willChange: decorativeAnimations ? 'transform, opacity' : undefined }}
            className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] bg-accent/5 rounded-full blur-[120px]"
          />
          <motion.div
            animate={decorativeAnimations ? {
              opacity: [0.2, 0.4, 0.2],
              x: [0, -30, 0]
            } : undefined}
            transition={decorativeAnimations
              ? { duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }
              : undefined}
            style={{ opacity: 0.3, willChange: decorativeAnimations ? 'transform, opacity' : undefined }}
            className="absolute bottom-[-10%] left-[-20%] w-[600px] h-[600px] bg-blue-500/5 rounded-full blur-[120px]"
          />
        </div>

        <div className="relative z-10 w-full h-full">
          <EmptyChatSuggestions onSelectSuggestion={(prompt) => {
            setInput(prompt)
            if (textareaRef.current) {
              textareaRef.current.focus()
            }
          }} />
        </div>
      </div>
    )
  }), [attachScrollerNode, language, setInput, textareaRef, decorativeAnimations])

  return (
    <div
      className={`absolute inset-0 overflow-hidden bg-background-secondary transition-colors ${isDragging ? 'bg-accent/5 ring-2 ring-inset ring-accent' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex flex-col h-full">

        {/* Header - 简洁版 */}
        {chatMode !== 'plan' && <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between h-10 px-3 bg-background/80 backdrop-blur-xl select-none transition-all duration-300">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {/* 分支选择器 - 始终显示，点击展开分支管理 */}
            <BranchSelector
              language={language}
              onClick={() => {
                setSidebarTab('branches')
                setSidebarOpen(true)
              }}
            />
            <ActiveTaskQuickSwitch
              language={language}
              onOpenTaskCenter={() => {
                setSidebarTab('history')
                setSidebarOpen(true)
              }}
            />
          </div>

          <div className="ml-2 flex shrink-0 items-center gap-1">
            <AnimatePresence>
              {showScrollButton && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.2 }}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => scrollToBottom('smooth')}
                    title={t('chatPanel.scrollToBottom', asLanguage(language))}
                    className="hover:bg-accent/10 text-accent transition-colors"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setSidebarTab('history')
                setSidebarOpen(true)
              }}
              title={language === 'zh'
                ? `Agent 任务${taskAttentionCount > 0 ? ` · ${taskAttentionCount} 个需要关注` : ''}`
                : `Agent tasks${taskAttentionCount > 0 ? ` · ${taskAttentionCount} need attention` : ''}`}
              className={`transition-colors ${taskAttentionCount > 0 ? 'bg-accent/[0.1] text-accent hover:bg-accent/[0.14]' : 'text-text-muted hover:bg-surface-hover hover:text-text-primary'}`}
            >
              <ListTree className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => createThread({ mode: chatMode, origin: 'user' })}
              title={t('chatPanel.newChat', asLanguage(language))}
              className="hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
            >
              <Plus className="w-4 h-4" />
            </Button>
            <div className="w-px h-4 bg-text-primary/10 mx-1" />
            <Button
              variant="ghost"
              size="icon"
              onClick={clearMessages}
              className="hover:bg-red-500/10 hover:text-red-500 text-text-muted transition-colors"
              title={t('clearChat', asLanguage(language))}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>}

        <TaskCommandCenter
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          initialTab={sidebarTab}
        />

        {/* Drag Overlay */}
        <AnimatePresence>
          {isDragging && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center pointer-events-none"
            >
              <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="flex flex-col items-center gap-4 p-8 rounded-3xl border border-accent/30 bg-surface/90 shadow-2xl shadow-accent/20"
              >
                <div className="p-5 rounded-full bg-accent/10 border border-accent/20 relative">
                  <div className="absolute inset-0 bg-accent/20 blur-xl rounded-full animate-pulse" />
                  <Upload className="w-10 h-10 text-accent relative z-10" />
                </div>
                <div className="text-center">
                  <p className="text-lg font-medium text-text-primary mb-1">{t('chatPanel.dropFilesToAdd', asLanguage(language))}</p>
                  <p className="text-sm text-text-muted">{t('chatPanel.supportsCodeAndImages', asLanguage(language))}</p>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Messages Area */}
        <div className={`flex-1 min-h-0 relative z-0 flex flex-col ${chatMode === 'plan' ? '' : 'pt-12'}`}>
          {/* API Key Warning */}
          {!hasApiKey && (
            <div className="m-4 p-4 border border-warning/20 bg-warning/5 rounded-xl flex gap-3 backdrop-blur-sm relative z-10">
              <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0" />
              <div>
                <span className="font-medium text-sm text-warning block mb-1">{t('setupRequired', language)}</span>
                <p className="text-xs text-text-muted">{t('setupRequiredDesc', language)}</p>
              </div>
            </div>
          )}

          {/* Message List */}
          <div className="flex-1 relative overflow-hidden flex flex-col min-h-0">
            {/* 过渡用的骨架屏 */}
            <AnimatePresence>
              {(isSwitchingThread || isHydratingActiveThread) && (
                <motion.div
                  initial={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="absolute inset-0 z-30 bg-background-secondary pointer-events-auto"
                >
                  <ChatMessagesSkeleton />
                </motion.div>
              )}
            </AnimatePresence>

            {chatMode === 'plan' ? <PlanWorkbench onOverlayChange={setPlanOverlayOpen} /> : <MemoizedVirtuoso
                key={currentThreadId ?? 'no-thread'}
                ref={virtuosoRef}
                data={timelineItems}
                computeItemKey={computeTimelineItemKey}
                atBottomStateChange={handleBottomStateChange}
                rangeChanged={handleTimelineRangeChanged}
                initialTopMostItemIndex={initialIndexRef.current}
                followOutput={followOutput}
                itemContent={renderTimelineItemContent}
                className="flex-1 custom-scrollbar w-full h-full"
                style={CHAT_TIMELINE_STYLE}
                overscan={12}
                atBottomThreshold={atBottomThreshold}
                totalListHeightChanged={handleTotalListHeightChanged}
                skipAnimationFrameInResizeObserver
                components={virtuosoComponents}
              />}
          </div>

          {/* File Mention Popup */}
          {
            showFileMention && (
              <MentionPopup
                position={mentionPosition}
                query={mentionQuery}
                candidates={mentionCandidates}
                loading={mentionLoading}
                onSelect={handleSelectMention}
                onClose={() => { setShowFileMention(false); setMentionQuery('') }}
              />
            )
          }

          {/* Slash Command Popup */}
          {
            showSlashCommand && (
              <SlashCommandPopup
                query={slashCommandQuery}
                position={mentionPosition}
                onSelect={handleSlashCommand}
                onClose={() => { setShowSlashCommand(false); setSlashCommandQuery('') }}
              />
            )
          }

          {/* Bottom Input Area - Unified Tray */}
          <div className={`shrink-0 z-20 flex-col ${chatMode === 'plan' && planOverlayOpen ? 'hidden' : 'flex'}`}>
            <div className="mx-4 mb-4 flex flex-col">
              {/* Dock 区域：无内容时不占空间，有内容时用动画平滑展开，
                  避免固定 min-h 造成的底部空白，同时通过过渡动画防止抖动。 */}
              {chatMode !== 'plan' && (
                <div className="relative shrink-0 z-30">
                  <UnifiedStatusTray
                    pendingChanges={pendingChanges}
                    todos={todos}
                    isStreaming={isStreaming}
                    isAwaitingApproval={isAwaitingApproval}
                    pendingToolCall={pendingToolCall}
                    pendingToolCalls={pendingToolCalls}
                    onStop={abort}
                    onReviewFile={handleReviewFile}
                    onAcceptFile={handleAcceptFile}
                    onRejectFile={handleRejectFile}
                    onUndoAll={handleUndoAll}
                    onKeepAll={handleKeepAll}
                    onApproveTool={approveCurrentTool}
                    onApproveToolForTask={approveCurrentToolForTask}
                    onRejectTool={rejectCurrentTool}
                    onQueueSendNow={(id) => {
                      useMessageQueueStore.getState().promote(id)
                      abort()
                    }}
                  />
                </div>
              )}

              {/* Input Component */}
              <ChatInput
                input={input}
                setInput={setInput}
                images={images}
                setImages={setImages}
                isStreaming={isStreaming}
                hasApiKey={hasApiKey}
                hasPendingToolCall={!!pendingToolCall}
                compact={chatMode === 'plan'}
                onSubmit={handleSubmit}
                onAbort={abort}
                onInputChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onOptimizePrompt={handleOptimizePrompt}
                isOptimizingPrompt={isOptimizingPrompt}
                textareaRef={textareaRef}
                inputContainerRef={inputContainerRef}
                contextItems={visibleContextItems}
                onRemoveContextItem={(item) => {
                  const index = contextItems.indexOf(item)
                  if (index !== -1) {
                    removeContextItem(index)
                  }
                }}
                activeFilePath={contextFilePath}
                onAddFile={handleAddCurrentFile}
              />
            </div>
          </div>
        </div>
      </div>
    </div >
  )
}
