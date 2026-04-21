import { memo, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Archive, ChevronDown, Layers3, ListTodo, MessageSquareQuote, Sparkles } from 'lucide-react'
import { useStore } from '@store'
import type { ContextSnapshotPart } from '@/renderer/agent/types'

interface CompressionDigestCardProps {
  part: ContextSnapshotPart
}

const levelTone: Record<number, { badge: string; dot: string; glow: string }> = {
  0: { badge: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20', dot: 'bg-emerald-400', glow: 'shadow-emerald-500/10' },
  1: { badge: 'text-blue-300 bg-blue-500/10 border-blue-500/20', dot: 'bg-blue-400', glow: 'shadow-blue-500/10' },
  2: { badge: 'text-yellow-300 bg-yellow-500/10 border-yellow-500/20', dot: 'bg-yellow-400', glow: 'shadow-yellow-500/10' },
  3: { badge: 'text-orange-300 bg-orange-500/10 border-orange-500/20', dot: 'bg-orange-400', glow: 'shadow-orange-500/10' },
  4: { badge: 'text-red-300 bg-red-500/10 border-red-500/20', dot: 'bg-red-400', glow: 'shadow-red-500/10' },
}

function getCopy(language: string, part: ContextSnapshotPart, activeTaskCount: number) {
  const isZh = language === 'zh'
  const isHandoff = part.snapshotKind === 'handoff'

  return {
    title: isHandoff
      ? (isZh ? '上下文续接快照' : 'Context Handoff Snapshot')
      : (isZh ? '上下文压缩快照' : 'Context Compression Snapshot'),
    subtitle: isHandoff
      ? (isZh ? '新线程将从这份续接包恢复目标、步骤和任务列表。' : 'A new thread should resume from this packet.')
      : (isZh ? '较早历史已折叠为结构化上下文，但关键任务状态仍被保留。' : 'Older history was folded into this structured state.'),
    objective: isZh ? '当前目标' : 'Objective',
    lastRequest: isZh ? '最近用户请求' : 'Last Request',
    pending: isZh ? '待续步骤' : 'Pending Steps',
    tasks: isZh ? '任务列表' : 'Task List',
    noObjective: isZh ? '未记录目标' : 'No objective recorded',
    completedStat: isZh ? `${part.summary.completedSteps.length} 已完成` : `${part.summary.completedSteps.length} completed`,
    pendingStat: isZh ? `${part.summary.pendingSteps.length} 待续` : `${part.summary.pendingSteps.length} pending`,
    taskStat: isZh ? `${activeTaskCount} 个活跃任务` : `${activeTaskCount} active tasks`,
  }
}

export const CompressionDigestCard = memo(({ part }: CompressionDigestCardProps) => {
  const [expanded, setExpanded] = useState(true)
  const language = useStore(state => state.language || 'zh')
  const todos = part.summary.todos || []
  const activeTodos = todos.filter(todo => todo.status !== 'completed')
  const tone = levelTone[part.level] || levelTone[3]
  const copy = getCopy(language, part, activeTodos.length)

  const visiblePending = useMemo(() => part.summary.pendingSteps.slice(0, 5), [part.summary.pendingSteps])
  const visibleTodos = useMemo(() => activeTodos.slice(0, 5), [activeTodos])
  const note = part.note || copy.subtitle

  return (
    <div className={`my-3 overflow-hidden rounded-2xl border border-border/50 bg-surface/40 backdrop-blur-md shadow-[0_10px_30px_-18px_rgba(0,0,0,0.45)] transition-all ${tone.glow}`}>
      <button
        onClick={() => setExpanded(value => !value)}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-text-primary/[0.03]"
      >
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${tone.dot}`} />
            <span className="text-[11px] font-semibold tracking-wide text-text-primary">{copy.title}</span>
            <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${tone.badge}`}>
              L{part.level}
            </span>
          </div>

          <div className="text-[11px] leading-relaxed text-text-muted">{note}</div>

          <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-text-muted/80">
            <span className="inline-flex items-center gap-1 rounded-full bg-text-primary/[0.04] px-2 py-0.5">
              <Sparkles className="h-3 w-3 text-accent/80" />
              {copy.completedStat}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-text-primary/[0.04] px-2 py-0.5">
              <Archive className="h-3 w-3 text-orange-300" />
              {copy.pendingStat}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-text-primary/[0.04] px-2 py-0.5">
              <ListTodo className="h-3 w-3 text-blue-300" />
              {copy.taskStat}
            </span>
          </div>
        </div>

        <ChevronDown className={`mt-0.5 h-4 w-4 text-text-muted transition-transform ${expanded ? '' : '-rotate-90'}`} />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="space-y-3 px-4 pb-4">
              {part.lastUserRequest && (
                <div className="rounded-xl border border-border/40 bg-background/15 px-3 py-2.5">
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-text-muted/70">
                    <MessageSquareQuote className="h-3 w-3" />
                    {copy.lastRequest}
                  </div>
                  <div className="text-[11px] leading-relaxed text-text-secondary">
                    {part.lastUserRequest}
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-border/40 bg-background/25 px-3 py-2.5">
                <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-text-muted/70">
                  <Layers3 className="h-3 w-3" />
                  {copy.objective}
                </div>
                <div className="text-[12px] leading-relaxed text-text-primary/90">
                  {part.summary.objective || copy.noObjective}
                </div>
              </div>

              {visiblePending.length > 0 && (
                <div className="rounded-xl border border-border/40 bg-background/20 px-3 py-2.5">
                  <div className="mb-2 text-[10px] uppercase tracking-wide text-text-muted/70">{copy.pending}</div>
                  <div className="space-y-1.5">
                    {visiblePending.map((step, index) => (
                      <div key={`${part.id}-pending-${index}`} className="text-[11px] leading-relaxed text-text-secondary">
                        {index + 1}. {step}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {visibleTodos.length > 0 && (
                <div className="rounded-xl border border-border/40 bg-background/20 px-3 py-2.5">
                  <div className="mb-2 text-[10px] uppercase tracking-wide text-text-muted/70">{copy.tasks}</div>
                  <div className="space-y-1.5">
                    {visibleTodos.map((todo, index) => (
                      <div key={`${part.id}-todo-${index}`} className="flex items-start gap-2 text-[11px] leading-relaxed text-text-secondary">
                        <span className={`mt-[4px] h-1.5 w-1.5 rounded-full ${todo.status === 'in_progress' ? 'bg-accent animate-pulse' : 'bg-text-muted/40'}`} />
                        <span>{todo.status === 'in_progress' ? todo.activeForm : todo.content}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})

CompressionDigestCard.displayName = 'CompressionDigestCard'
