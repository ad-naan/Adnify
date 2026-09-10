import { History } from 'lucide-react'
import { OtterAsset } from '@/renderer/components/brand/OtterAsset'
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
      <div className="flex flex-col items-center text-center">
        <OtterAsset asset="creative" className="h-24 w-24 object-contain" alt="" />
        <h2>{t('planDesign.heading', language)}</h2>
        <p>{t('planDesign.subtitle', language)}</p>
      </div>

      {recent.length > 0 && <details className="plan-empty-recent mx-auto text-left">
        <summary className="cursor-pointer text-xs text-text-muted">{t('planWorkbenchEmpty.recentPlans', language)}</summary>
        <div className="mb-2 flex items-center justify-between px-1"><span className="text-[11px] font-medium text-text-muted">{t('planWorkbenchEmpty.recentPlans', language)}</span><button onClick={onOpenHistory} className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-accent"><History className="h-3 w-3" />{t('common.all', language)}</button></div>
        <div className="mt-2">
          {recent.slice(0, 3).map(entry => <button key={entry.id} onClick={() => onSelectHistory(entry)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-hover/40">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-muted/35" />
            <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-text-secondary">{entry.title}</span>
            {entry.taskCount !== undefined && <span className="shrink-0 text-[11px] tabular-nums text-text-muted">{entry.completedCount}/{entry.taskCount}</span>}
          </button>)}
        </div>
      </details>}

    </div>
  </div>
}
