import { CheckCircle2, Circle, LoaderCircle, Sparkles } from 'lucide-react'
import type { PlanActivityItem, PlanWorkbenchStage } from '@/renderer/agent/plan/planWorkbenchProjection'
import type { PlanPlanningState } from '@/renderer/agent/plan/planWorkflowGuard'
import { t, type Language, type TranslationKey } from '@shared/i18n'

interface ProcessingCopy {
  title: TranslationKey
  detail: TranslationKey
}

/** 需求阶段的文案跟着 `planningState` 走。 */
const PHASE_COPY: Record<PlanPlanningState, ProcessingCopy> = {
  needs_clarification: { title: 'planWorkbenchProcessing.needsClarification', detail: 'planWorkbenchProcessing.needsClarificationDetail' },
  waiting_for_answer: { title: 'planWorkbenchProcessing.waitingForAnswer', detail: 'planWorkbenchProcessing.waitingForAnswerDetail' },
  ready_to_create: { title: 'planWorkbenchProcessing.readyToCreate', detail: 'planWorkbenchProcessing.readyToCreateDetail' },
  revision_requested: { title: 'planWorkbenchProcessing.revisionRequested', detail: 'planWorkbenchProcessing.revisionRequestedDetail' },
  ready_to_update: { title: 'planWorkbenchProcessing.readyToUpdate', detail: 'planWorkbenchProcessing.readyToUpdateDetail' },
  plan_created: { title: 'planWorkbenchProcessing.planCreated', detail: 'planWorkbenchProcessing.planCreatedDetail' },
}

/**
 * 执行、验收两个阶段不看 `planningState`（那是需求阶段的状态机），所以按 stage 覆盖。
 * `requirements` 故意缺席 —— 缺的那一格就是"回退到 PHASE_COPY"。
 */
const STAGE_COPY: Partial<Record<PlanWorkbenchStage, ProcessingCopy>> = {
  execution: { title: 'planWorkbenchProcessing.execution', detail: 'planWorkbenchProcessing.executionDetail' },
  validation: { title: 'planWorkbenchProcessing.validation', detail: 'planWorkbenchProcessing.validationDetail' },
}

function activityIcon(status: PlanActivityItem['status']) {
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
  if (status === 'active') return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-accent" />
  return <Circle className="h-3.5 w-3.5 text-text-muted/50" />
}

export function PlanWorkbenchProcessing({ planningState, stage, activities, elapsedSeconds, language }: {
  planningState: PlanPlanningState
  stage: PlanWorkbenchStage
  activities: PlanActivityItem[]
  elapsedSeconds: number
  language: Language
}) {
  const copy = STAGE_COPY[stage] ?? PHASE_COPY[planningState]
  const recent = activities.filter(activity => activity.stage === stage).slice(-4)
  const waiting = stage === 'requirements' && planningState === 'waiting_for_answer'

  return <section className="overflow-hidden rounded-xl border border-border/55 bg-surface/[0.055]">
    <div className="flex items-start gap-3.5 px-4 py-4">
      <div className="relative flex h-9 w-9 shrink-0 items-center justify-center">
        <span className={`absolute inset-0 rounded-full border border-accent/20 ${waiting ? 'animate-pulse' : 'animate-spin'}`} />
        <span className="absolute inset-[5px] rounded-full border border-accent/35 border-l-transparent" />
        {waiting ? <Circle className="h-2.5 w-2.5 text-accent" /> : <Sparkles className="h-4 w-4 text-accent" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <h2 className={`text-[12px] font-semibold text-text-primary ${waiting ? '' : 'tool-text-shimmer'}`}>{t(copy.title, language)}</h2>
          <time className="shrink-0 text-[11px] tabular-nums text-text-muted">{elapsedSeconds}s</time>
        </div>
        <p className="mt-1.5 text-[10px] leading-5 text-text-muted">{t(copy.detail, language)}</p>
      </div>
    </div>

    {!waiting && <div className="relative h-0.5 overflow-hidden bg-border/35">
      <span className="absolute inset-y-0 w-1/3 animate-[plan-processing_1.35s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-accent to-transparent" />
    </div>}

    <div className="border-t border-border/40 px-4 py-3.5">
      <div className="mb-2.5 text-[11px] font-medium text-text-muted">{t('planWorkbenchProcessing.liveProcess', language)}</div>
      {recent.length > 0 ? <div className="space-y-2.5">
        {recent.map(activity => <div key={activity.id} className="grid grid-cols-[16px_minmax(0,1fr)] gap-2.5">
          <span className="mt-0.5">{activityIcon(activity.status)}</span>
          <div className="min-w-0"><div className="truncate text-[10px] font-medium text-text-secondary">{activity.title}</div>{activity.detail && <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-text-muted">{activity.detail}</div>}</div>
        </div>)}
      </div> : waiting ? <div className="flex items-center gap-2 text-[11px] text-text-muted"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />{t('planWorkbenchProcessing.waitingForInput', language)}</div> : <div className="space-y-2.5" aria-label={t('planWorkbenchProcessing.processing', language)}>
        {[0, 1, 2].map(index => <div key={index} className="flex items-center gap-2.5"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent/60" style={{ animationDelay: `${index * 160}ms` }} /><span className="h-2.5 animate-pulse rounded bg-text-primary/[0.055]" style={{ width: `${72 - index * 13}%`, animationDelay: `${index * 160}ms` }} /></div>)}
      </div>}
    </div>
  </section>
}
