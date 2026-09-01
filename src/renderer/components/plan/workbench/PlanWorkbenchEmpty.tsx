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
  return <div className="flex h-full min-h-[360px] items-center justify-center px-5 pb-24">
    <div className="w-full max-w-[360px]">
      <div className="flex flex-col items-center text-center">
        <div className="relative mb-4 flex h-20 w-20 items-center justify-center rounded-2xl border border-border/50 bg-surface/[0.16]">
          <OtterAsset asset="working" className="h-16 w-16 object-contain" alt="" />
          <div className="absolute -bottom-2 -right-2 flex h-9 w-9 items-center justify-center rounded-xl border border-border/55 bg-background shadow-sm"><OtterAsset asset="plans" className="h-6 w-6 object-contain" alt="" /></div>
        </div>
        <h2 className="text-[13px] font-semibold text-text-primary">{t('planWorkbenchEmpty.startWithAnObjective', language)}</h2>
        <p className="mt-2 max-w-[300px] text-[10px] leading-[18px] text-text-muted">{t('planWorkbenchEmpty.describeWhatYouWant', language)}</p>
      </div>

      {recent.length > 0 && <div className="mt-7">
        <div className="mb-2 flex items-center justify-between px-1"><span className="text-[11px] font-medium text-text-muted">{t('planWorkbenchEmpty.recentPlans', language)}</span><button onClick={onOpenHistory} className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-accent"><History className="h-3 w-3" />{t('common.all', language)}</button></div>
        <div className="divide-y divide-border/35 overflow-hidden rounded-xl border border-border/50 bg-surface/[0.08]">
          {recent.slice(0, 3).map(entry => <button key={entry.id} onClick={() => onSelectHistory(entry)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-hover/40">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-muted/35" />
            <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-text-secondary">{entry.title}</span>
            {entry.taskCount !== undefined && <span className="shrink-0 text-[11px] tabular-nums text-text-muted">{entry.completedCount}/{entry.taskCount}</span>}
          </button>)}
        </div>
      </div>}

      {recent.length === 0 && <div className="mt-6 text-center text-[10px] text-text-muted/65">{t('planWorkbenchEmpty.createdPlansWillBe', language)}</div>}
    </div>
  </div>
}
