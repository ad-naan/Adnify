import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
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
  if (status === 'completed') return 'bg-text-muted/40'
  if (status === 'active') return 'bg-accent'
  return 'bg-text-muted/45'
}

export function PlanWorkbenchActivity({ activities, language }: { activities: PlanActivityItem[], language: string }) {
  const [toolsOpen, setToolsOpen] = useState(false)
  const latestIsActive = activities.at(-1)?.status === 'active'
  const history = latestIsActive ? activities.slice(0, -1) : activities
  const completedTools = history.filter(activity => activity.source === 'tool' && activity.status === 'completed')
  const visibleEvents = history.filter(activity => activity.source === 'ai' || activity.status !== 'completed')
  if (!visibleEvents.length && !completedTools.length) return null

  return <section className="mt-5">
    <div className="mb-2.5 flex items-center justify-between px-0.5"><span className="text-[10px] font-medium text-text-muted">{language === 'zh' ? '过程' : 'Activity'}</span>{completedTools.length > 0 && <button onClick={() => setToolsOpen(value => !value)} className="inline-flex items-center gap-1 text-[10px] text-text-muted/70 hover:text-text-secondary"><span>{completedTools.length} {language === 'zh' ? '个工具动作' : 'tool actions'}</span><ChevronDown className={`h-3 w-3 transition-transform ${toolsOpen ? 'rotate-180' : ''}`} /></button>}</div>
    {visibleEvents.length > 0 && <div className="relative ml-1 border-l border-border/45 pl-4">
      {visibleEvents.reverse().map(activity => <article key={activity.id} className="relative pb-3.5 last:pb-0">
        <span className={`absolute -left-[18.5px] top-[6px] h-[7px] w-[7px] rounded-full ring-4 ring-background ${dotTone(activity.status)} ${activity.status === 'active' ? 'animate-pulse' : ''}`} />
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium leading-4 text-text-secondary">{activity.title}</div>
            {activity.detail && <p className="mt-1 line-clamp-3 text-[10px] leading-[17px] text-text-muted">{activity.detail}</p>}
          </div>
          <span className="shrink-0 text-[10px] text-text-muted/60">{stageLabel(activity.stage, language)}</span>
        </div>
      </article>)}
    </div>}
    {toolsOpen && completedTools.length > 0 && <div className="mt-2 divide-y divide-border/30 overflow-hidden rounded-lg border border-border/40 bg-surface/[0.06]">
      {completedTools.slice().reverse().map(activity => <div key={activity.id} className="flex items-center gap-2 px-2.5 py-2">
        <span className="h-1 w-1 shrink-0 rounded-full bg-text-muted/35" />
        <span className="min-w-0 flex-1 truncate text-[11px] text-text-muted">{activity.title}</span>
        {activity.detail && <span className="max-w-[45%] truncate text-[10px] text-text-muted/55">{activity.detail}</span>}
      </div>)}
    </div>}
  </section>
}
