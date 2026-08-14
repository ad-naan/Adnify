import type { PlanActivityItem } from '@/renderer/agent/plan/planWorkbenchProjection'

const stageLabel = (stage: PlanActivityItem['stage'], language: string) => {
  const labels = {
    requirements: ['需求', 'Requirements'],
    plan: ['计划', 'Plan'],
    execution: ['执行', 'Execution'],
    validation: ['验收', 'Validation'],
  } as const
  return labels[stage][language === 'zh' ? 0 : 1]
}

const dotTone = (status: PlanActivityItem['status']) => {
  if (status === 'blocked') return 'bg-red-400'
  if (status === 'warning') return 'bg-amber-400'
  if (status === 'completed') return 'bg-green-500'
  if (status === 'active') return 'bg-accent'
  return 'bg-text-muted/45'
}

export function PlanWorkbenchActivity({ activities, language }: { activities: PlanActivityItem[], language: string }) {
  if (activities.length <= 1) return null

  return <section className="mt-5">
    <div className="mb-2.5 px-0.5 text-[10px] font-medium text-text-muted">{language === 'zh' ? '过程记录' : 'Activity'}</div>
    <div className="relative ml-1 border-l border-border/55 pl-4">
      {activities.slice(0, -1).reverse().map(activity => <article key={activity.id} className="relative pb-3.5 last:pb-0">
        <span className={`absolute -left-[18.5px] top-[6px] h-[7px] w-[7px] rounded-full ring-4 ring-background ${dotTone(activity.status)}`} />
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium leading-4 text-text-secondary">{activity.title}</div>
            {activity.detail && <p className="mt-1 line-clamp-3 text-[10px] leading-[17px] text-text-muted">{activity.detail}</p>}
          </div>
          <span className="shrink-0 text-[9px] text-text-muted/70">{stageLabel(activity.stage, language)}</span>
        </div>
      </article>)}
    </div>
  </section>
}
