import { Plus, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PlanHistoryEntry } from '@/renderer/agent/plan/planHistoryProjection'
import { OtterAsset } from '@/renderer/components/brand/OtterAsset'
import { t, type Language, type TranslationKey } from '@shared/i18n'

/**
 * 状态码 → 文案键。三个状态的文案和 `common.*` 逐字相同，就指过去而不是再造一份。
 * 未知状态原样显示状态码（后端加了新状态但界面还没跟上时，至少能看出是哪个）。
 */
const STATUS_KEYS: Record<string, TranslationKey> = {
  draft: 'planHistoryDrawer.status.draft',
  approved: 'planHistoryDrawer.status.approved',
  executing: 'common.running',
  pausing: 'planHistoryDrawer.status.pausing',
  paused: 'planHistoryDrawer.status.paused',
  stopping: 'planHistoryDrawer.status.stopping',
  stopped: 'planHistoryDrawer.status.stopped',
  completed: 'common.completed',
  failed: 'common.failed',
}

const statusText = (status: PlanHistoryEntry['status'], language: Language) => {
  if (!status) return t('planHistoryDrawer.conversation', language)
  const key = STATUS_KEYS[status]
  return key ? t(key, language) : status
}
function groupName(timestamp: number, language: Language) {
  const value = new Date(timestamp)
  const today = new Date()
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startValue = new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  if (startValue === startToday) return t('planHistoryDrawer.today', language)
  if (startToday - startValue < 7 * 86_400_000) return t('planHistoryDrawer.last7Days', language)
  return t('planHistoryDrawer.earlier', language)
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
  language: Language
  onClose: () => void
  onSelect: (entry: PlanHistoryEntry) => void
  onDelete: (entry: PlanHistoryEntry) => void
  onCreateNew: () => void
  portalTarget?: HTMLElement | null
}

export function PlanHistoryDrawer({ open, entries, language, onClose, onSelect, onDelete, onCreateNew, portalTarget }: Props) {
  const [query, setQuery] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
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
    const previousFocus = document.activeElement as HTMLElement | null
    panelRef.current?.querySelector('input')?.focus()
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) closeRef.current()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current() }
      if (event.key === 'Tab') {
        const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, [tabindex="0"]') || [])
        const first = items[0], last = items.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('pointerdown', closeOnPointerDown)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown)
      document.removeEventListener('keydown', closeOnEscape)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [open, portalTarget])

  if (!open) return null

  const drawer = <div className="plan-history-overlay plan-readable pointer-events-auto absolute inset-0 z-40 bg-text-primary/5">
    <aside ref={panelRef} role="dialog" aria-modal="true" aria-label={t('common.planHistory', language)} className="absolute inset-y-0 right-0 flex w-[480px] max-w-full flex-col bg-background shadow-[-16px_0_48px_-28px_rgba(15,23,42,0.3)]">
      <header className="flex h-20 shrink-0 items-center gap-2 px-6">
        <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-text-primary">{t('common.planHistory', language)}</div><div className="mt-1 text-xs text-text-muted">{t('planHistoryDrawer.separateFromAgentConversations', language)}</div></div>
        <button onClick={onClose} aria-label={t('closeTerminal', language)} className="rounded-md p-1.5 text-text-muted hover:bg-surface-hover hover:text-text-primary"><X className="h-3.5 w-3.5" /></button>
      </header>
      <div className="shrink-0 px-3.5 py-3">
        <label className="relative block"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted/55" /><input value={query} onChange={event => setQuery(event.target.value)} aria-label={t('planHistoryDrawer.searchPlanHistory', language)} placeholder={t('planHistoryDrawer.searchPlanHistory', language)} className="h-10 w-full rounded-lg border-0 bg-surface/30 pl-9 pr-3 text-xs text-text-primary outline-none placeholder:text-text-muted/60 focus-visible:ring-1 focus-visible:ring-accent/40" /></label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-3 custom-scrollbar">
        {groups.length > 0 ? groups.map(group => <section key={group.label} className="mb-4 last:mb-0">
          <div className="mb-1.5 text-[10px] font-medium text-text-muted">{group.label}</div>
          <div>
            {group.entries.map(entry => <div key={entry.id} className="group flex items-start gap-1">
              <button onClick={() => { onSelect(entry); onClose() }} className="min-w-0 flex-1 py-3 text-left">
                <div className="grid grid-cols-[8px_minmax(0,1fr)_auto_auto] items-center gap-2.5"><span className={`h-1.5 w-1.5 rounded-full ${dotTone(entry)}`} /><div className="min-w-0 truncate text-[10px] font-medium text-text-secondary">{entry.title}</div><span className={`text-[10px] font-medium ${entry.status === 'completed' ? 'text-emerald-500' : entry.status === 'failed' ? 'text-red-400' : 'text-amber-500'}`}>{statusText(entry.status, language)}</span><span className="flex items-center gap-2 text-[10px] text-text-muted">{entry.taskCount !== undefined && <span>{entry.completedCount}/{entry.taskCount}</span>}<time>{new Date(entry.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></span></div>
              </button>
              {confirmingId === entry.id ? <div className="flex shrink-0 items-center gap-1 self-center">
                <button onClick={() => { onDelete(entry); setConfirmingId(null) }} className="rounded px-1.5 py-1 text-[10px] font-medium text-red-400 hover:bg-red-500/10">{t('planHistoryDrawer.delete', language)}</button>
                <button onClick={() => setConfirmingId(null)} className="rounded px-1.5 py-1 text-[10px] text-text-muted hover:bg-surface-hover">{t('cancel', language)}</button>
              </div> : <button onClick={() => setConfirmingId(entry.id)} aria-label={t('planHistoryDrawer.deletePlanHistory', language)} className="shrink-0 self-center rounded p-1.5 text-text-muted opacity-0 hover:bg-red-500/10 hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100"><Trash2 className="h-3 w-3" /></button>}
            </div>)}
          </div>
        </section>) : <div className="flex min-h-48 h-full flex-col items-center justify-center text-center"><OtterAsset asset="sleepyFace" className="h-16 w-16 object-contain opacity-75" /><div className="mt-4 text-sm font-medium text-text-secondary">{t(entries.length ? 'planHistoryDrawer.noMatchingPlans' : 'planDesign.noHistory', language)}</div><div className="mt-2 text-xs text-text-muted">{t(entries.length ? 'planHistoryDrawer.tryAnotherSearch' : 'planDesign.historyHint', language)}</div></div>}
      </div>
      <footer className="shrink-0 p-3.5">
        <button
          type="button"
          onClick={() => { onCreateNew(); onClose() }}
          className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-md bg-accent/[0.06] text-xs font-medium text-accent hover:bg-accent/10"
        >
          <Plus className="h-3 w-3" />
          {t('planHistoryDrawer.startANewPlan', language)}
        </button>
        <div className="mt-2 text-center text-[10px] text-text-muted">{t('planHistoryDrawer.records', language, { length: entries.length })}</div>
      </footer>
    </aside>
  </div>
  return portalTarget ? createPortal(drawer, portalTarget) : drawer
}
