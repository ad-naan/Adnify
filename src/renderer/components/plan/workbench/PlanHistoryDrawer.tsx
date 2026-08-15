import { History, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PlanHistoryEntry } from '@/renderer/agent/plan/planHistoryProjection'

const statusText = (status: PlanHistoryEntry['status'], language: string) => {
  if (!status) return language === 'zh' ? '需求对话' : 'Conversation'
  const map: Record<string, [string, string]> = {
    draft: ['待审阅', 'Draft'], approved: ['待执行', 'Ready'], executing: ['执行中', 'Running'],
    pausing: ['暂停中', 'Pausing'], paused: ['已暂停', 'Paused'], stopping: ['停止中', 'Stopping'],
    stopped: ['已停止', 'Stopped'], completed: ['已完成', 'Completed'], failed: ['失败', 'Failed'],
  }
  return map[status]?.[language === 'zh' ? 0 : 1] || status
}

interface Props {
  open: boolean
  entries: PlanHistoryEntry[]
  language: string
  onClose: () => void
  onSelect: (entry: PlanHistoryEntry) => void
  onDelete: (entry: PlanHistoryEntry) => void
}

export function PlanHistoryDrawer({ open, entries, language, onClose, onSelect, onDelete }: Props) {
  const [query, setQuery] = useState('')
  // Two-step confirm: a plan delete also removes its requirements doc and every
  // plan-task thread it spawned, none of which is recoverable.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const filtered = useMemo(() => entries.filter(entry => entry.title.toLowerCase().includes(query.trim().toLowerCase())), [entries, query])
  useEffect(() => {
    if (!open) {
      setConfirmingId(null)
      return
    }
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', closeOnPointerDown)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open, onClose])

  if (!open || entries.length === 0) return null

  return <aside ref={panelRef} className="absolute right-3 top-3 z-40 flex max-h-[360px] w-[min(310px,calc(100%-24px))] flex-col overflow-hidden rounded-xl border border-border/55 bg-background shadow-lg">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/40 px-3">
        <div className="min-w-0 flex-1"><span className="text-[10px] font-semibold text-text-primary">{language === 'zh' ? '历史计划' : 'Plan history'}</span><span className="ml-2 text-[8px] tabular-nums text-text-muted/65">{entries.length}</span></div>
        <button onClick={onClose} aria-label={language === 'zh' ? '关闭' : 'Close'} className="rounded-md p-1.5 text-text-muted hover:bg-surface-hover hover:text-text-primary"><X className="h-3.5 w-3.5" /></button>
      </div>
      {entries.length > 6 && <div className="px-2.5 pb-1 pt-2.5">
        <div className="relative"><Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted/60" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={language === 'zh' ? '搜索历史计划' : 'Search plans'} className="h-8 w-full rounded-lg border border-border/45 bg-surface/[0.12] pl-8 pr-3 text-[10px] text-text-primary outline-none placeholder:text-text-muted/45 focus:border-accent/35" /></div>
      </div>}
      <div className="min-h-0 overflow-y-auto p-2 custom-scrollbar">
        {filtered.length > 0 ? <div className="space-y-0.5">{filtered.map(entry => <div key={entry.id} className="group relative flex items-start gap-1 rounded-lg pr-1 hover:bg-surface-hover/45">
          <button onClick={() => { onSelect(entry); onClose() }} className="min-w-0 flex-1 rounded-lg px-2.5 py-2 text-left">
            <div className="flex items-start gap-3"><span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${entry.status === 'executing' ? 'bg-accent' : entry.status === 'failed' ? 'bg-red-400' : entry.status === 'completed' ? 'bg-green-500' : 'bg-text-muted/35'}`} /><div className="min-w-0 flex-1"><div className="truncate text-[10px] font-medium text-text-secondary">{entry.title}</div><div className="mt-1 flex items-center gap-2 text-[8px] text-text-muted"><span>{statusText(entry.status, language)}</span>{entry.taskCount !== undefined && <span>{entry.completedCount}/{entry.taskCount}</span>}<span>{new Date(entry.updatedAt).toLocaleDateString()}</span></div></div></div>
          </button>
          {confirmingId === entry.id
            ? <div className="flex shrink-0 items-center gap-1 self-center">
                <button
                  onClick={() => { onDelete(entry); setConfirmingId(null) }}
                  className="rounded px-1.5 py-1 text-[8px] font-medium text-red-400 hover:bg-red-500/10"
                >{language === 'zh' ? '确认删除' : 'Delete'}</button>
                <button
                  onClick={() => setConfirmingId(null)}
                  className="rounded px-1.5 py-1 text-[8px] text-text-muted hover:bg-surface-hover"
                >{language === 'zh' ? '取消' : 'Cancel'}</button>
              </div>
            : <button
                onClick={() => setConfirmingId(entry.id)}
                title={entry.planId
                  ? (language === 'zh' ? '删除计划及其任务线程' : 'Delete plan and its task threads')
                  : (language === 'zh' ? '删除会话' : 'Delete conversation')}
                className="shrink-0 self-center rounded p-1.5 text-text-muted opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100"
              ><Trash2 className="h-3 w-3" /></button>}
        </div>)}</div> : <div className="flex min-h-32 flex-col items-center justify-center px-5 py-7 text-center">
          <span className="mb-2.5 flex h-9 w-9 items-center justify-center rounded-lg border border-border/40 bg-surface/[0.12] text-text-muted/55"><History className="h-4 w-4" /></span>
          <div className="text-[10px] font-medium text-text-secondary">{query ? (language === 'zh' ? '没有找到匹配记录' : 'No matching plans') : (language === 'zh' ? '还没有历史计划' : 'No plan history yet')}</div>
          <div className="mt-1 text-[8px] leading-4 text-text-muted/70">{query ? (language === 'zh' ? '换一个关键词试试' : 'Try another search') : (language === 'zh' ? '完成需求确认并创建计划后，会自动保存在这里' : 'Created plans will appear here automatically')}</div>
        </div>}
      </div>
    </aside>
}
