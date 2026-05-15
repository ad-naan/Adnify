/**
 * 统一状态托盘
 * 
 * 将 AgentStatusBar（执行状态/文件变更）、TodoListPanel（任务列表）、
 * MessageQueuePanel（消息队列）合并为一个紧凑的面板。
 * 
 * 设计思路：
 * - 单一容器，共享边框和背景
 * - 顶部：状态指示器 + Tab 切换（Files / Tasks / Queue）
 * - 中部：根据当前 Tab 显示对应内容
 * - 紧凑模式：无内容时只显示状态行
 */

import React, { useState, useCallback, useMemo, memo } from 'react'
import {
  X,
  Check,
  ExternalLink,
  Square,
  ChevronDown,
  FileCode,
  FilePlus,
  FileX,
  CheckCheck,
  XCircle,
  FolderOpen,
  ListTodo,
  Layers,
  Play,
  Pencil,
  Trash2,
  ChevronUp,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { getFileName, getDirname } from '@shared/utils/pathUtils'
import type { PendingChange, TodoItem } from '@/renderer/agent/types'
import type { QueuedMessage } from '@/renderer/agent/types/queue'
import { useStore } from '@store'
import { useMessageQueueStore } from '@/renderer/agent/store/slices/queueSlice'

type TabView = 'files' | 'tasks' | 'queue'

interface UnifiedStatusTrayProps {
  pendingChanges: PendingChange[]
  todos: TodoItem[]
  isStreaming: boolean
  isAwaitingApproval: boolean
  onStop?: () => void
  onReviewFile?: (filePath: string) => void
  onAcceptFile?: (filePath: string) => void
  onRejectFile?: (filePath: string) => void
  onUndoAll?: () => void
  onKeepAll?: () => void
  onApproveTool?: () => void
  onRejectTool?: () => void
  onQueueSendNow?: (id: string) => void
}

function UnifiedStatusTray({
  pendingChanges,
  todos,
  isStreaming,
  isAwaitingApproval,
  onStop,
  onReviewFile,
  onAcceptFile,
  onRejectFile,
  onUndoAll,
  onKeepAll,
  onApproveTool,
  onRejectTool,
  onQueueSendNow,
}: UnifiedStatusTrayProps) {
  const language = useStore(s => s.language)
  const expandByDefault = useStore(s => s.agentConfig.expandAgentBlocksByDefault ?? false)

  const queue = useMessageQueueStore(s => s.queue)
  const removeFromQueue = useMessageQueueStore(s => s.remove)
  const updateQueueContent = useMessageQueueStore(s => s.updateContent)
  const clearQueue = useMessageQueueStore(s => s.clearQueue)
  const reorderQueue = useMessageQueueStore(s => s.reorder)

  const hasChanges = pendingChanges.length > 0
  const hasTodos = todos.length > 0
  const hasQueue = queue.length > 0
  const hasStatus = isStreaming || isAwaitingApproval

  // 计算可用的 tabs
  const availableTabs = useMemo(() => {
    const tabs: TabView[] = []
    if (hasChanges || hasStatus) tabs.push('files')
    if (hasTodos) tabs.push('tasks')
    if (hasQueue) tabs.push('queue')
    return tabs
  }, [hasChanges, hasStatus, hasTodos, hasQueue])

  const [activeTab, setActiveTab] = useState<TabView>('files')
  const [isExpanded, setIsExpanded] = useState(expandByDefault)

  // 确保 activeTab 在可用范围内
  const currentTab = availableTabs.includes(activeTab)
    ? activeTab
    : availableTabs[0] || 'files'

  // 如果没有任何内容可显示，不渲染
  if (availableTabs.length === 0 && !hasStatus) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="mb-3"
    >
      <div className="rounded-xl border border-border/50 bg-surface/40 backdrop-blur-md overflow-hidden shadow-[0_4px_16px_-8px_rgba(0,0,0,0.1)] transition-all">
        {/* Header: 状态 + Tab 切换 */}
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2">
            {/* 状态指示器 */}
            {hasStatus && (
              <div className="flex items-center gap-2 mr-2">
                {isStreaming ? (
                  <>
                    <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                    <span className="text-[11px] font-medium tool-text-shimmer">
                      Processing...
                    </span>
                  </>
                ) : (
                  <>
                    <div className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                    <span className="text-[11px] font-medium text-amber-400/80">
                      Waiting
                    </span>
                  </>
                )}
              </div>
            )}

            {/* Tab 切换按钮 */}
            {availableTabs.length > 1 && (
              <div className="flex items-center gap-0.5 px-1 py-0.5 rounded-lg bg-surface-hover/50">
                {availableTabs.includes('files') && (
                  <TabButton
                    active={currentTab === 'files'}
                    onClick={() => setActiveTab('files')}
                    title="Files"
                    badge={hasChanges ? pendingChanges.length : undefined}
                  >
                    <FolderOpen className="w-3 h-3" />
                  </TabButton>
                )}
                {availableTabs.includes('tasks') && (
                  <TabButton
                    active={currentTab === 'tasks'}
                    onClick={() => setActiveTab('tasks')}
                    title="Tasks"
                    badge={hasTodos ? todos.filter(t => t.status !== 'completed').length : undefined}
                  >
                    <ListTodo className="w-3 h-3" />
                  </TabButton>
                )}
                {availableTabs.includes('queue') && (
                  <TabButton
                    active={currentTab === 'queue'}
                    onClick={() => setActiveTab('queue')}
                    title="Queue"
                    badge={queue.length}
                  >
                    <Layers className="w-3 h-3" />
                  </TabButton>
                )}
              </div>
            )}

            {/* 单 tab 时显示标签文字 */}
            {availableTabs.length === 1 && (
              <span className="text-[11px] font-medium text-text-muted/70">
                {currentTab === 'files' && `${pendingChanges.length} file${pendingChanges.length > 1 ? 's' : ''} changed`}
                {currentTab === 'tasks' && `${todos.filter(t => t.status === 'completed').length}/${todos.length} Tasks`}
                {currentTab === 'queue' && `${queue.length} ${language === 'zh' ? '条待发送' : 'queued'}`}
              </span>
            )}
          </div>

          {/* 右侧操作 */}
          <div className="flex items-center gap-1.5">
            {/* Stop 按钮 */}
            {isStreaming && (
              <button
                onClick={onStop}
                className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium text-text-muted/60 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all border border-transparent hover:border-red-500/20"
              >
                <Square className="w-2 h-2 fill-current" />
                <span>Stop</span>
              </button>
            )}

            {/* 审批按钮 */}
            {!isStreaming && isAwaitingApproval && (onApproveTool || onRejectTool) && (
              <div className="flex items-center gap-1">
                {onRejectTool && (
                  <button
                    onClick={onRejectTool}
                    className="px-2 py-1 text-[10px] font-medium text-text-muted/70 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all"
                  >
                    Cancel
                  </button>
                )}
                {onApproveTool && (
                  <button
                    onClick={onApproveTool}
                    className="px-2.5 py-1 text-[10px] font-medium bg-accent text-white hover:bg-accent-hover rounded-md transition-all"
                  >
                    Approve
                  </button>
                )}
              </div>
            )}

            {/* Files tab 批量操作 */}
            {currentTab === 'files' && hasChanges && (
              <div className="flex items-center gap-1">
                <button
                  onClick={onUndoAll}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                  title="Reject All"
                >
                  <XCircle className="w-3 h-3" />
                </button>
                <button
                  onClick={onKeepAll}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-green-400 bg-green-500/10 hover:bg-green-500/20 rounded-lg transition-all"
                  title="Accept All"
                >
                  <CheckCheck className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Queue tab 清空 */}
            {currentTab === 'queue' && hasQueue && (
              <button
                onClick={clearQueue}
                className="p-1 rounded-md text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                title={language === 'zh' ? '清空队列' : 'Clear queue'}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}

            {/* 展开/折叠 */}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1 rounded-md text-text-muted/50 hover:text-text-muted transition-colors"
            >
              <motion.div
                animate={{ rotate: isExpanded ? 0 : -90 }}
                transition={{ duration: 0.15 }}
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </motion.div>
            </button>
          </div>
        </div>

        {/* Content Area */}
        <AnimatePresence mode="wait">
          {isExpanded && (
            <motion.div
              key={currentTab}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden border-t border-border/30"
            >
              {currentTab === 'files' && hasChanges && (
                <FileChangesContent
                  pendingChanges={pendingChanges}
                  onReviewFile={onReviewFile}
                  onAcceptFile={onAcceptFile}
                  onRejectFile={onRejectFile}
                />
              )}

              {currentTab === 'tasks' && hasTodos && (
                <TasksContent todos={todos} />
              )}

              {currentTab === 'queue' && hasQueue && (
                <QueueContent
                  queue={queue}
                  language={language}
                  onRemove={removeFromQueue}
                  onUpdateContent={updateQueueContent}
                  onSendNow={onQueueSendNow}
                  onReorder={reorderQueue}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

export default memo(UnifiedStatusTray)

// ===== Sub-components =====

function TabButton({
  active,
  onClick,
  title,
  badge,
  children,
}: {
  active: boolean
  onClick: () => void
  title: string
  badge?: number
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-medium transition-all ${active
          ? 'text-text-primary bg-surface shadow-sm'
          : 'text-text-muted/50 hover:text-text-muted/80'
        }`}
      title={title}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span className={`min-w-[14px] h-[14px] flex items-center justify-center text-[9px] font-bold rounded-full ${active ? 'bg-accent/15 text-accent' : 'bg-text-muted/10 text-text-muted/60'
          }`}>
          {badge}
        </span>
      )}
    </button>
  )
}


// ===== File Changes Content =====

function FileChangesContent({
  pendingChanges,
  onReviewFile,
  onAcceptFile,
  onRejectFile,
}: {
  pendingChanges: PendingChange[]
  onReviewFile?: (filePath: string) => void
  onAcceptFile?: (filePath: string) => void
  onRejectFile?: (filePath: string) => void
}) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())

  const groupedChanges = useMemo(() => {
    const groups = new Map<string, PendingChange[]>()
    for (const change of pendingChanges) {
      const dir = getDirname(change.relativePath || change.filePath) || '.'
      if (!groups.has(dir)) groups.set(dir, [])
      groups.get(dir)!.push(change)
    }
    return groups
  }, [pendingChanges])

  const toggleDir = useCallback((dir: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      next.has(dir) ? next.delete(dir) : next.add(dir)
      return next
    })
  }, [])

  return (
    <div className="max-h-[200px] overflow-y-auto custom-scrollbar">
      {Array.from(groupedChanges.entries()).map(([dir, dirChanges]) => (
        <div key={dir}>
          {groupedChanges.size > 1 && (
            <div
              className="flex items-center gap-2 px-4 py-1.5 text-[10px] text-text-muted/50 hover:text-text-muted cursor-pointer hover:bg-surface-hover transition-colors"
              onClick={() => toggleDir(dir)}
            >
              <ChevronDown className={`w-3 h-3 transition-transform ${expandedDirs.has(dir) ? '' : '-rotate-90'}`} />
              <FolderOpen className="w-3 h-3 text-yellow-500/50" />
              <span className="font-medium">{dir || '.'}</span>
              <span className="text-[9px]">({dirChanges.length})</span>
            </div>
          )}
          {(expandedDirs.has(dir) || groupedChanges.size === 1) && (
            <div className={groupedChanges.size > 1 ? 'ml-4' : ''}>
              {dirChanges.map(change => {
                const displayPath = change.relativePath || change.filePath
                const fileName = getFileName(displayPath)
                const TypeIcon = change.changeType === 'create' ? FilePlus
                  : change.changeType === 'delete' ? FileX : FileCode
                const typeColor = change.changeType === 'create' ? 'text-green-400/60'
                  : change.changeType === 'delete' ? 'text-red-400/60' : 'text-text-muted/60'

                return (
                  <div
                    key={change.filePath}
                    className="flex items-center justify-between px-4 py-2 hover:bg-surface-hover cursor-pointer transition-colors group"
                    onClick={() => onReviewFile?.(change.filePath)}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <TypeIcon className={`w-3.5 h-3.5 ${typeColor} shrink-0 group-hover:text-accent/60 transition-colors`} />
                      <span className="text-[11px] text-text-muted/80 group-hover:text-text-secondary truncate transition-colors" title={displayPath}>
                        {fileName}
                      </span>
                      <div className="flex items-center gap-2 text-[9px] font-mono opacity-50 group-hover:opacity-80 transition-opacity">
                        {(change.linesAdded ?? 0) > 0 && <span className="text-green-400">+{change.linesAdded}</span>}
                        {(change.linesRemoved ?? 0) > 0 && <span className="text-red-400">-{change.linesRemoved}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); onReviewFile?.(change.filePath) }}
                        className="p-1 text-text-muted/50 hover:text-accent hover:bg-accent/10 rounded transition-colors"
                        title="View Diff"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onRejectFile?.(change.filePath) }}
                        className="p-1 text-text-muted/50 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                        title="Discard"
                      >
                        <X className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onAcceptFile?.(change.filePath) }}
                        className="p-1 text-green-400/50 hover:text-green-400 hover:bg-green-500/10 rounded transition-colors"
                        title="Accept"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ===== Tasks Content =====

function TasksContent({ todos }: { todos: TodoItem[] }) {
  return (
    <div className="px-3 pb-2.5 pt-1.5 max-h-[200px] overflow-y-auto space-y-0.5">
      {todos.map((todo, i) => {
        const isCompleted = todo.status === 'completed'
        const isActive = todo.status === 'in_progress'
        return (
          <div
            key={i}
            className={`flex items-start gap-2 py-1 px-1 rounded-md transition-colors ${isActive ? 'bg-accent/5' : ''}`}
          >
            <div className="mt-0.5">
              {isCompleted && <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />}
              {isActive && <div className="w-2 h-2 rounded-full bg-accent animate-pulse flex-shrink-0 mx-[3px]" />}
              {todo.status === 'pending' && <div className="w-3.5 h-3.5 rounded-full border border-text-muted/30 flex-shrink-0" />}
            </div>
            <span className={`text-[11px] leading-relaxed ${isCompleted ? 'text-text-muted/60 line-through' : ''
              } ${isActive ? 'text-text-primary font-medium' : ''} ${todo.status === 'pending' ? 'text-text-muted' : ''
              }`}>
              {isActive ? todo.activeForm : todo.content}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ===== Queue Content =====

function QueueContent({
  queue,
  language,
  onRemove,
  onUpdateContent,
  onSendNow,
  onReorder,
}: {
  queue: QueuedMessage[]
  language: string
  onRemove: (id: string) => void
  onUpdateContent: (id: string, content: any) => void
  onSendNow?: (id: string) => void
  onReorder: (from: number, to: number) => void
}) {
  return (
    <div className="px-2 pb-2 pt-1 space-y-1 max-h-[200px] overflow-y-auto custom-scrollbar">
      {queue.map((item, index) => (
        <QueueItemRow
          key={item.id}
          item={item}
          index={index}
          total={queue.length}
          language={language}
          onRemove={onRemove}
          onUpdateContent={onUpdateContent}
          onSendNow={onSendNow}
          onReorder={onReorder}
        />
      ))}
    </div>
  )
}

function QueueItemRow({
  item,
  index,
  total,
  language,
  onRemove,
  onUpdateContent,
  onSendNow,
  onReorder,
}: {
  item: QueuedMessage
  index: number
  total: number
  language: string
  onRemove: (id: string) => void
  onUpdateContent: (id: string, content: any) => void
  onSendNow?: (id: string) => void
  onReorder: (from: number, to: number) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')

  const displayText = typeof item.content === 'string'
    ? item.content
    : Array.isArray(item.content)
      ? (item.content.find((p: any) => p.type === 'text') as any)?.text || ''
      : ''

  const startEdit = useCallback(() => {
    setEditValue(displayText)
    setIsEditing(true)
  }, [displayText])

  const confirmEdit = useCallback(() => {
    if (editValue.trim()) {
      onUpdateContent(item.id, editValue.trim())
    }
    setIsEditing(false)
  }, [editValue, item.id, onUpdateContent])

  return (
    <div className={`group relative flex items-start gap-2 px-2.5 py-2 rounded-lg border transition-colors ${item.status === 'sending'
        ? 'border-accent/30 bg-accent/5'
        : 'border-transparent hover:border-border/50 hover:bg-surface-hover/50'
      }`}>
      {/* Index */}
      <div className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-md bg-text-primary/5 text-[10px] font-bold text-text-muted mt-0.5">
        {index + 1}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <div className="flex flex-col gap-1.5">
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmEdit() }
                if (e.key === 'Escape') setIsEditing(false)
              }}
              className="w-full px-2 py-1.5 text-xs bg-background/80 border border-accent/30 rounded-md text-text-primary resize-none focus:outline-none focus:ring-1 focus:ring-accent/50 min-h-[36px] max-h-[80px]"
              rows={2}
              autoFocus
            />
            <div className="flex items-center gap-1">
              <button onClick={confirmEdit} className="px-2 py-0.5 text-[10px] font-medium bg-accent/10 text-accent rounded-md hover:bg-accent/20 transition-colors">
                <Check className="w-3 h-3 inline mr-0.5" />
                {language === 'zh' ? '确认' : 'Save'}
              </button>
              <button onClick={() => setIsEditing(false)} className="px-2 py-0.5 text-[10px] font-medium text-text-muted rounded-md hover:bg-surface-hover transition-colors">
                {language === 'zh' ? '取消' : 'Cancel'}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-text-secondary leading-relaxed line-clamp-2 break-all">
            {displayText || (language === 'zh' ? '(多模态消息)' : '(multimodal)')}
          </p>
        )}
      </div>

      {/* Actions */}
      {!isEditing && (
        <div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {index > 0 && (
            <button onClick={() => onReorder(index, index - 1)} className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-active transition-colors" title="Move up">
              <ChevronUp className="w-3 h-3" />
            </button>
          )}
          {index < total - 1 && (
            <button onClick={() => onReorder(index, index + 1)} className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-active transition-colors" title="Move down">
              <ChevronDown className="w-3 h-3" />
            </button>
          )}
          <button onClick={startEdit} className="p-1 rounded text-text-muted hover:text-accent hover:bg-accent/10 transition-colors" title="Edit">
            <Pencil className="w-3 h-3" />
          </button>
          {onSendNow && (
            <button onClick={() => onSendNow(item.id)} className="p-1 rounded text-text-muted hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors" title="Send now">
              <Play className="w-3 h-3" />
            </button>
          )}
          <button onClick={() => onRemove(item.id)} className="p-1 rounded text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Remove">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Sending indicator */}
      {item.status === 'sending' && (
        <div className="absolute top-2 right-2">
          <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
        </div>
      )}
    </div>
  )
}
