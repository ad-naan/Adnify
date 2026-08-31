/**
 * 消息队列面板
 * 显示在 ChatInput 上方，展示待发送的缓冲消息
 * 支持编辑、删除、排序、立即发送
 */
import { memo, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Play,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  Check,
  Layers,
} from 'lucide-react'
import { useMessageQueueStore } from '@/renderer/agent/store/slices/queueSlice'
import { useStore } from '@store'
import type { QueuedMessage } from '@/renderer/agent/types/queue'
import { t, asLanguage } from '@renderer/i18n'

interface MessageQueuePanelProps {
  onSendNow: (id: string) => void
}

export default memo(function MessageQueuePanel({ onSendNow }: MessageQueuePanelProps) {
  const language = useStore(s => s.language)
  const queue = useMessageQueueStore(s => s.queue)
  const remove = useMessageQueueStore(s => s.remove)
  const updateContent = useMessageQueueStore(s => s.updateContent)
  const clearQueue = useMessageQueueStore(s => s.clearQueue)
  const reorder = useMessageQueueStore(s => s.reorder)

  const [isExpanded, setIsExpanded] = useState(true)

  if (queue.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, height: 0 }}
      animate={{ opacity: 1, y: 0, height: 'auto' }}
      exit={{ opacity: 0, y: 8, height: 0 }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      className="mb-3 overflow-hidden"
    >
      <div className="rounded-xl border border-accent/20 bg-surface/60 backdrop-blur-md shadow-sm overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 py-2 cursor-pointer select-none hover:bg-surface-hover/50 transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-5 h-5 rounded-md bg-accent/10">
              <Layers className="w-3 h-3 text-accent" />
            </div>
            <span className="text-xs font-medium text-text-secondary">
              {t('messageQueuePanel.sendQueue', asLanguage(language))}
            </span>
            <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-accent/15 text-accent rounded-full min-w-[18px] text-center">
              {queue.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); clearQueue() }}
              className="p-1 rounded-md text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title={t('common.clearQueue', asLanguage(language))}
            >
              <Trash2 className="w-3 h-3" />
            </button>
            <motion.div
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronUp className="w-3.5 h-3.5 text-text-muted" />
            </motion.div>
          </div>
        </div>

        {/* Queue Items */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div className="px-2 pb-2 space-y-1 max-h-[200px] overflow-y-auto custom-scrollbar">
                {queue.map((item, index) => (
                  <QueueItem
                    key={item.id}
                    item={item}
                    index={index}
                    total={queue.length}
                    language={language}
                    onRemove={remove}
                    onUpdateContent={updateContent}
                    onSendNow={onSendNow}
                    onReorder={reorder}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
})


// 单条队列消息项
interface QueueItemProps {
  item: QueuedMessage
  index: number
  total: number
  language: string
  onRemove: (id: string) => void
  onUpdateContent: (id: string, content: string) => void
  onSendNow: (id: string) => void
  onReorder: (from: number, to: number) => void
}

function QueueItem({
  item,
  index,
  total,
  language,
  onRemove,
  onUpdateContent,
  onSendNow,
  onReorder,
}: QueueItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const editRef = useRef<HTMLTextAreaElement>(null)

  const displayText = typeof item.content === 'string'
    ? item.content
    : Array.isArray(item.content)
      ? (item.content.find((p: any) => p.type === 'text') as any)?.text || ''
      : ''

  const startEdit = useCallback(() => {
    setEditValue(displayText)
    setIsEditing(true)
    setTimeout(() => editRef.current?.focus(), 50)
  }, [displayText])

  const confirmEdit = useCallback(() => {
    if (editValue.trim()) {
      onUpdateContent(item.id, editValue.trim())
    }
    setIsEditing(false)
  }, [editValue, item.id, onUpdateContent])

  const cancelEdit = useCallback(() => {
    setIsEditing(false)
  }, [])

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      confirmEdit()
    } else if (e.key === 'Escape') {
      cancelEdit()
    }
  }, [confirmEdit, cancelEdit])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8, height: 0 }}
      transition={{ duration: 0.15 }}
      className={`group relative flex items-start gap-2 px-2.5 py-2 rounded-lg border transition-colors ${
        item.status === 'sending'
          ? 'border-accent/30 bg-accent/5'
          : 'border-transparent hover:border-border/50 hover:bg-surface-hover/50'
      }`}
    >
      {/* Index Badge */}
      <div className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-md bg-text-primary/5 text-[10px] font-bold text-text-muted mt-0.5">
        {index + 1}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <div className="flex flex-col gap-1.5">
            <textarea
              ref={editRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleEditKeyDown}
              className="w-full px-2 py-1.5 text-xs bg-background/80 border border-accent/30 rounded-md text-text-primary resize-none focus:outline-none focus:ring-1 focus:ring-accent/50 min-h-[36px] max-h-[80px]"
              rows={2}
            />
            <div className="flex items-center gap-1">
              <button
                onClick={confirmEdit}
                className="px-2 py-0.5 text-[10px] font-medium bg-accent/10 text-accent rounded-md hover:bg-accent/20 transition-colors"
              >
                <Check className="w-3 h-3 inline mr-0.5" />
                {t('common.save', asLanguage(language))}
              </button>
              <button
                onClick={cancelEdit}
                className="px-2 py-0.5 text-[10px] font-medium text-text-muted rounded-md hover:bg-surface-hover transition-colors"
              >
                {t('cancel', asLanguage(language))}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-text-secondary leading-relaxed line-clamp-2 break-all">
            {displayText || (t('common.multimodal', asLanguage(language)))}
          </p>
        )}

        {/* Mode & Context Info */}
        {!isEditing && item.contextItems.length > 0 && (
          <div className="flex items-center gap-1 mt-1">
            <span className="text-[10px] text-text-muted/60">
              +{item.contextItems.length} {t('messageQueuePanel.context', asLanguage(language))}
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      {!isEditing && (
        <div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Move Up */}
          {index > 0 && (
            <button
              onClick={() => onReorder(index, index - 1)}
              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-active transition-colors"
              title={t('messageQueuePanel.moveUp', asLanguage(language))}
            >
              <ChevronUp className="w-3 h-3" />
            </button>
          )}
          {/* Move Down */}
          {index < total - 1 && (
            <button
              onClick={() => onReorder(index, index + 1)}
              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-active transition-colors"
              title={t('messageQueuePanel.moveDown', asLanguage(language))}
            >
              <ChevronDown className="w-3 h-3" />
            </button>
          )}
          {/* Edit */}
          <button
            onClick={startEdit}
            className="p-1 rounded text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
            title={t('editor.edit', asLanguage(language))}
          >
            <Pencil className="w-3 h-3" />
          </button>
          {/* Send Now */}
          <button
            onClick={() => onSendNow(item.id)}
            className="p-1 rounded text-text-muted hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
            title={t('messageQueuePanel.sendNow', asLanguage(language))}
          >
            <Play className="w-3 h-3" />
          </button>
          {/* Remove */}
          <button
            onClick={() => onRemove(item.id)}
            className="p-1 rounded text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title={t('messageQueuePanel.remove', asLanguage(language))}
          >
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
    </motion.div>
  )
}
