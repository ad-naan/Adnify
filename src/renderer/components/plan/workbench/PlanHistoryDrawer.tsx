import { Plus, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PlanHistoryEntry } from '@/renderer/agent/plan/planHistoryProjection'
import { OtterAsset } from '@/renderer/components/brand/OtterAsset'

const statusText = (status: PlanHistoryEntry['status'], language: string) => {
  if (!status) return language === 'zh' ? '需求对话' : 'Conversation'
  const map: Record<string, [string, string]> = {
    draft: ['待审阅', 'Draft'], approved: ['待执行', 'Ready'], executing: ['执行中', 'Running'],
    pausing: ['暂停中', 'Pausing'], paused: ['已暂停', 'Paused'], stopping: ['停止中', 'Stopping'],
    stopped: ['已停止', 'Stopped'], completed: ['已完成', 'Completed'], failed: ['失败', 'Failed'],
  }
  return map[status]?.[language === 'zh' ? 0 : 1] || status
}
function groupName(timestamp: number, language: string) {
  const value = new Date(timestamp)
  const today = new Date()
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startValue = new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  if (startValue === startToday) return language === 'zh' ? '今天' : 'Today'
  if (startToday - startValue < 7 * 86_400_000) return language === 'zh' ? '最近 7 天' : 'Last 7 days'
  return language === 'zh' ? '更早' : 'Earlier'
}

function dotTone(entry: PlanHistoryEntry) {
  if (entry.status === 'executing') return 'bg-accent'
  if (entry.status === 'failed') return 'bg-red-400'
  if (entry.status === 'completed') return 'bg-emerald-400'
  if (!entry.status) return 'bg-blue-400'
  return 'bg-amber-400'
}

interface Props {
  open: boolean
  entries: PlanHistoryEntry[]
  language: string
  onClose: () => void
  onSelect: (entry: PlanHistoryEntry) => void
  onDelete: (entry: PlanHistoryEntry) => void
  onCreateNew: () => void
}

export function PlanHistoryDrawer({ open, entries, language, onClose, onSelect, onDelete, onCreateNew }: Props) {
  const [query, setQuery] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const filtered = useMemo(() => entries.filter(entry => entry.title.toLowerCase().includes(query.trim().toLowerCase())), [entries, query])
  const groups = useMemo(() => filtered.reduce<Array<{ label: string, entries: PlanHistoryEntry[] }>>((result, entry) => {
    const label = groupName(entry.updatedAt, language)
    const current = result.at(-1)
    if (current?.label === label) current.entries.push(entry)
    else result.push({ label, entries: [entry] })
    return result
  }, []), [filtered, language])

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

  if (!open) return null

  return <div className="absolute inset-0 z-40 bg-background">
    <aside ref={panelRef} className="absolute inset-0 flex flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/45 px-3.5">
        <div className="min-w-0 flex-1"><div className="text-[11px] font-semibold text-text-primary">{language === 'zh' ? '计划历史' : 'Plan history'}</div><div className="mt-1 text-[10px] text-text-muted">{language === 'zh' ? '独立于 Agent 对话记录' : 'Separate from agent conversations'}</div></div>
        <button onClick={onClose} aria-label={language === 'zh' ? '关闭' : 'Close'} className="rounded-md p-1.5 text-text-muted hover:bg-surface-hover hover:text-text-primary"><X className="h-3.5 w-3.5" /></button>
      </header>
      <div className="shrink-0 px-3.5 py-3">
        <label className="relative block"><Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted/55" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={language === 'zh' ? '搜索计划历史' : 'Search plan history'} className="h-8 w-full rounded-md border border-border/50 bg-surface/[0.1] pl-8 pr-3 text-[11px] text-text-primary outline-none placeholder:text-text-muted/45 focus:border-accent/35" /></label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-3 custom-scrollbar">
        {groups.length > 0 ? groups.map(group => <section key={group.label} className="mb-4 last:mb-0">
          <div className="mb-1.5 text-[10px] font-medium text-text-muted">{group.label}</div>
          <div className="divide-y divide-border/35 border-y border-border/35">
            {group.entries.map(entry => <div key={entry.id} className="group flex items-start gap-1">
              <button onClick={() => { onSelect(entry); onClose() }} className="min-w-0 flex-1 py-3 text-left">
                <div className="grid grid-cols-[8px_minmax(0,1fr)_auto_auto] items-center gap-2.5"><span className={`h-1.5 w-1.5 rounded-full ${dotTone(entry)}`} /><div className="min-w-0 truncate text-[10px] font-medium text-text-secondary">{entry.title}</div><span className={`text-[10px] font-medium ${entry.status === 'completed' ? 'text-emerald-500' : entry.status === 'failed' ? 'text-red-400' : 'text-amber-500'}`}>{statusText(entry.status, language)}</span><span className="flex items-center gap-2 text-[10px] text-text-muted">{entry.taskCount !== undefined && <span>{entry.completedCount}/{entry.taskCount}</span>}<time>{new Date(entry.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></span></div>
              </button>
              {confirmingId === entry.id ? <div className="flex shrink-0 items-center gap-1 self-center">
                <button onClick={() => { onDelete(entry); setConfirmingId(null) }} className="rounded px-1.5 py-1 text-[10px] font-medium text-red-400 hover:bg-red-500/10">{language === 'zh' ? '确认' : 'Delete'}</button>
                <button onClick={() => setConfirmingId(null)} className="rounded px-1.5 py-1 text-[10px] text-text-muted hover:bg-surface-hover">{language === 'zh' ? '取消' : 'Cancel'}</button>
              </div> : <button onClick={() => setConfirmingId(entry.id)} aria-label={language === 'zh' ? '删除计划记录' : 'Delete plan history'} className="shrink-0 self-center rounded p-1.5 text-text-muted opacity-0 hover:bg-red-500/10 hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100"><Trash2 className="h-3 w-3" /></button>}
            </div>)}
          </div>
        </section>) : <div className="flex min-h-48 flex-col items-center justify-center text-center"><OtterAsset asset="sleepyFace" className="h-12 w-12 object-contain opacity-75" /><div className="mt-3 text-[10px] font-medium text-text-secondary">{language === 'zh' ? '没有匹配的计划' : 'No matching plans'}</div><div className="mt-1 text-[10px] text-text-muted">{language === 'zh' ? '换一个关键词试试' : 'Try another search'}</div></div>}
      </div>
      <footer className="shrink-0 border-t border-border/40 p-3.5">
        <button
          type="button"
          onClick={() => { onCreateNew(); onClose() }}
          className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-border/55 text-[11px] font-medium text-text-secondary hover:border-accent/30 hover:bg-accent/[0.035] hover:text-accent"
        >
          <Plus className="h-3 w-3" />
          {language === 'zh' ? '开始新计划' : 'Start a new plan'}
        </button>
        <div className="mt-2 text-center text-[10px] text-text-muted">{language === 'zh' ? `共 ${entries.length} 条记录` : `${entries.length} records`}</div>
      </footer>
    </aside>
  </div>
}
