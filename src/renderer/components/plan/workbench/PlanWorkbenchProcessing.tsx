import { AlertCircle, CheckCircle2, ChevronDown, Circle, LoaderCircle } from 'lucide-react'
import { OtterAsset } from '@/renderer/components/brand/OtterAsset'
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

function activityIcon(status: PlanActivityItem['status'], historical = false) {
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
  if (status === 'blocked' || status === 'warning') return <AlertCircle className="h-3.5 w-3.5 plan-approval-ink" />
  if (status === 'active' && !historical) return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-accent" />
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
  const latest = recent.at(-1)
  const current = !waiting && latest && latest.status !== 'completed' ? latest : undefined
  const history = current ? recent.slice(0, -1) : recent
  const elapsed = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:${String(elapsedSeconds % 60).padStart(2, '0')}`

  return <section className="plan-processing overflow-hidden rounded-xl border border-border/55 bg-surface/[0.055]" aria-busy={!waiting}>
    <div className="flex items-start gap-3.5 px-4 py-4">
      <OtterAsset asset={waiting ? 'focused' : 'working'} className="h-11 w-11 shrink-0 object-contain" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[13px] font-semibold text-text-primary">{t(copy.title, language)}</h2>
          <time className="plan-processing-time">{elapsed}</time>
        </div>
        <p className="mt-1.5 text-[12px] leading-5 text-text-muted">{t(copy.detail, language)}</p>
      </div>
    </div>

    {!waiting && <div className="relative h-0.5 overflow-hidden bg-border/35">
      <span className="absolute inset-y-0 w-1/3 animate-[plan-processing_1.35s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-accent to-transparent" />
    </div>}

    <div className="border-t border-border/40 px-4 py-3.5">
      {current ? <div className="plan-processing-current">
        <span className="mt-0.5">{activityIcon(current.status)}</span>
        <div className="min-w-0"><div className="text-[13px] font-medium leading-5 text-text-primary">{current.title}</div>{current.detail && <p className="mt-1 text-xs leading-5 text-text-secondary">{current.detail}</p>}</div>
      </div> : <div className="flex items-center gap-2 text-xs leading-5 text-text-muted"><span className={`h-1.5 w-1.5 shrink-0 rounded-full bg-accent ${waiting ? '' : 'animate-pulse'}`} />{t(waiting ? 'planWorkbenchProcessing.waitingForInput' : 'planDesign.processingUpdate', language)}</div>}
      {history.length > 0 && <details className="plan-processing-history">
        <summary><ChevronDown size={13} /><span>{t('planDesign.recentActivity', language)}</span><span className="ml-auto tabular-nums">{history.length}</span></summary>
        <div className="space-y-3 pt-3">{history.map(activity => <div key={activity.id} className="grid grid-cols-[16px_minmax(0,1fr)] gap-2">
          <span className="mt-0.5">{activityIcon(activity.status, true)}</span>
          <div className="min-w-0 text-xs leading-5 text-text-secondary"><div>{activity.title}</div>{activity.detail && <p className="mt-0.5 text-text-muted">{activity.detail}</p>}</div>
        </div>)}</div>
      </details>}
    </div>
  </section>
}
