import { ArrowUpRight, History } from 'lucide-react'
import { PlanIntro } from '../PlanIntro'
import type { PlanHistoryEntry } from '@/renderer/agent/plan/planHistoryProjection'
import { t, type Language } from '@shared/i18n'

interface Props {
  language: Language
  recent: PlanHistoryEntry[]
  onOpenHistory: () => void
  onSelectHistory: (entry: PlanHistoryEntry) => void
}

export function PlanWorkbenchEmpty({ language, recent, onOpenHistory, onSelectHistory }: Props) {
  return <div className="plan-empty-content">
    <div className="w-full max-w-xl">
      <PlanIntro language={language} />

      {recent.length > 0 && <section className="plan-empty-recent mx-auto text-left">
        <div className="mb-2 flex items-center justify-between px-1"><span className="text-[11px] font-medium text-text-muted">{t('planWorkbenchEmpty.recentPlans', language)}</span><button onClick={onOpenHistory} className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-accent"><History className="h-3 w-3" />{t('common.all', language)}</button></div>
        <div className="mt-2">
          {recent.slice(0, 2).map(entry => <button key={entry.id} onClick={() => onSelectHistory(entry)} className="plan-recent-row">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-muted/35" />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-secondary">{entry.title}</span>
            {entry.taskCount !== undefined && <span className="shrink-0 text-[11px] tabular-nums text-text-muted">{entry.completedCount}/{entry.taskCount}</span>}
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          </button>)}
        </div>
      </section>}

    </div>
  </div>
}
