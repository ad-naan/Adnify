import { memo, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Boxes, Check, CheckCircle2, FileText, GitBranch, History, LoaderCircle, MessageSquareText, Play, Plus, RotateCcw, ShieldCheck, TriangleAlert, UserRoundCog } from 'lucide-react'
import type { PlanActivityStatus, PlanWorkbenchFocus } from '@/renderer/agent/plan/planWorkbenchProjection'
import { planReviewRiskParams } from '@/renderer/agent/plan/planWorkbenchProjection'
import { PlanWorkbenchActivity } from './PlanWorkbenchActivity'
import { PlanWorkbenchRuntime } from './PlanWorkbenchRuntime'
import { PlanWorkbenchQuestion } from './PlanWorkbenchQuestion'
import { usePlanWorkbenchController } from './usePlanWorkbenchController'
import { PlanWorkbenchEmpty } from './PlanWorkbenchEmpty'
import { PlanHistoryDrawer } from './PlanHistoryDrawer'
import { usePlanViewStore } from '@/renderer/agent/plan/planViewStore'
import { PlanWorkbenchProcessing } from './PlanWorkbenchProcessing'
import { useStore } from '@/renderer/store'
import { BUILTIN_PROVIDERS } from '@/shared/config/providers'
import { t, type Language } from '@shared/i18n'

const focusDot = (tone: PlanActivityStatus) => {
  if (tone === 'blocked') return 'bg-red-400'
  if (tone === 'warning') return 'bg-amber-400'
  if (tone === 'completed') return 'bg-green-500'
  return 'bg-accent'
}

const panelTitle = (stage: string, language: Language) => ({
  requirements: t('planWorkbench.requirementReview', language),
  plan: t('planWorkbench.planReview', language),
  execution: t('planWorkbench.runCenter', language),
  validation: t('planWorkbench.resultReview', language),
})[stage] || (t('planWorkbench.planMode', language))

function formatElapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

interface PlanWorkbenchProps {
  onOverlayChange?: (open: boolean) => void
}

export const PlanWorkbench = memo(function PlanWorkbench({ onOverlayChange }: PlanWorkbenchProps) {
  const providerConfigs = useStore(state => state.providerConfigs)
  const { language, plan, model, history, starting, startPlan, submitClarification, approve, reject, openThread, openHistoryEntry, deleteHistoryEntry, createNewPlan, acceptValidation, requestValidationChanges, revisePlan } = usePlanWorkbenchController()
  const selectedStage = usePlanViewStore(state => plan ? state.selectedStageByPlanId[plan.id] : undefined)
  const displayStage = selectedStage || model.stage
  const [historyOpen, setHistoryOpen] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  useEffect(() => {
    onOverlayChange?.(historyOpen)
    return () => onOverlayChange?.(false)
  }, [historyOpen, onOverlayChange])

  useEffect(() => {
    if (!model.isProcessing) {
      setElapsedSeconds(0)
      return
    }
    const startedAt = Date.now()
    setElapsedSeconds(0)
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [model.isProcessing, model.planningState])

  const visibleFocus = useMemo<PlanWorkbenchFocus | null>(() => {
    if (model.isProcessing && model.focus?.tone !== 'active') return {
      stage: model.stage,
      title: model.planningState === 'ready_to_create'
        ? (t('planWorkbench.creatingTheStructuredPlan', language))
        : (t('planWorkbench.preparingTheNextAction', language)),
      detail: model.planningState === 'ready_to_create'
        ? (t('planWorkbench.confirmedRequirementsAreBecoming', language))
        : (t('planWorkbench.modelAndToolActivity', language)),
      tone: 'active',
    }
    if (plan && model.canStart && !model.isProcessing) return {
      stage: 'plan',
      title: t('planWorkbench.planIsReady', language),
      detail: `${model.tasks.length} ${t('planWorkbench.tasks', language)} · ${plan.executionMode === 'parallel' ? (t('planWorkbench.parallel', language)) : (t('planWorkbench.sequential', language))}`,
      tone: 'info',
    }
    if (plan?.status === 'completed') return {
      stage: 'validation',
      title: t('planWorkbench.executionComplete', language),
      detail: `${model.completedCount}/${model.tasks.length} ${t('common.tasksCompleted', language)}`,
      tone: model.tasks.some(item => item.task.status === 'failed') ? 'warning' : 'completed',
    }
    return model.focus
  }, [language, model, plan])

  const validation = useMemo(() => {
    if (!plan) return null
    const failed = plan.tasks.filter(task => task.status === 'failed').length
    const files = Array.from(new Set(plan.tasks.flatMap(task => task.producesFiles || [])))
    const started = plan.tasks.map(task => task.startedAt).filter((value): value is number => typeof value === 'number')
    const completed = plan.tasks.map(task => task.completedAt).filter((value): value is number => typeof value === 'number')
    const duration = started.length && completed.length ? Math.max(...completed) - Math.min(...started) : 0
    return { failed, files, duration }
  }, [plan])

  if (!model.hasSession) return <div className="plan-readable relative h-full bg-background">
    <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
      <button
        onClick={createNewPlan}
        aria-label={t('planWorkbench.startNewPlan', language)}
        title={t('planWorkbench.startNewPlan', language)}
        className="rounded-md p-1.5 text-text-muted hover:bg-surface-hover hover:text-text-primary transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => setHistoryOpen(true)}
        aria-label={t('common.planHistory', language)}
        title={t('common.planHistory', language)}
        className="rounded-md p-1.5 text-text-muted hover:bg-surface-hover hover:text-text-primary transition-colors"
      >
        <History className="h-3.5 w-3.5" />
      </button>
    </div>
    <PlanWorkbenchEmpty language={language} recent={history} onOpenHistory={() => setHistoryOpen(true)} onSelectHistory={openHistoryEntry} />
    <PlanHistoryDrawer open={historyOpen} entries={history} language={language} onClose={() => setHistoryOpen(false)} onSelect={openHistoryEntry} onDelete={deleteHistoryEntry} onCreateNew={createNewPlan} />
  </div>

  return <div className="plan-readable relative flex h-full min-h-0 flex-col bg-background">
    <header className="shrink-0 border-b border-border/45 px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 truncate text-[12px] font-semibold text-text-primary">{displayStage === 'execution' && model.stage === 'execution' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}{panelTitle(displayStage, language)}</div>
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-text-muted">{displayStage === 'execution' ? <>{model.stage === 'execution' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}{plan?.executionMode === 'parallel' ? (t('planWorkbench.parallelOrchestration', language)) : (t('planWorkbench.sequentialOrchestration', language))}{model.stage === 'execution' && <span className="ml-auto tabular-nums">{t('planWorkbench.total', language)} {formatElapsed(elapsedSeconds * 1000)}</span>}</> : plan?.name || (t('planWorkbench.buildingTheBrief', language))}</div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={createNewPlan}
            aria-label={t('planWorkbench.startNewPlan', language)}
            title={t('planWorkbench.startNewPlan', language)}
            className="rounded-md p-1.5 text-text-muted hover:bg-surface-hover hover:text-text-primary transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setHistoryOpen(true)}
            aria-label={t('common.planHistory', language)}
            title={t('common.planHistory', language)}
            className="rounded-md p-1.5 text-text-muted hover:bg-surface-hover hover:text-text-primary transition-colors"
          >
            <History className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </header>

    <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
      <div className="px-3.5 pb-5 pt-3.5">
        {model.isProcessing && <PlanWorkbenchProcessing planningState={model.planningState} stage={model.stage} activities={model.activities} elapsedSeconds={elapsedSeconds} language={language} />}

        {!model.isProcessing && visibleFocus && displayStage === 'requirements' && visibleFocus.stage === 'requirements' && <section className="border-b border-border/40 pb-3.5">
          <div className="flex items-center gap-2 text-[10px] font-medium text-text-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${focusDot(visibleFocus.tone)} ${visibleFocus.tone === 'active' ? 'animate-pulse' : ''}`} />
            <span>{visibleFocus.tone === 'warning' ? (t('planWorkbench.attention', language)) : visibleFocus.tone === 'completed' ? (t('planWorkbench.complete', language)) : (t('planWorkbench.currentFocus', language))}</span>
            <span className="ml-auto tabular-nums">{model.isProcessing ? `${elapsedSeconds}s` : visibleFocus.progress !== undefined ? `${visibleFocus.progress}%` : ''}</span>
          </div>
          <div className={`mt-2 text-[12px] font-semibold leading-5 text-text-primary ${visibleFocus.tone === 'active' ? 'tool-text-shimmer' : ''}`}>{visibleFocus.title}</div>
          {visibleFocus.detail && <p className="mt-1 text-[11px] leading-[16px] text-text-muted">{visibleFocus.detail}</p>}
          {model.isProcessing && <div className="mt-3 h-px overflow-hidden bg-border/45"><div className="h-full w-1/3 animate-pulse bg-accent/75" /></div>}
        </section>}

        {model.requestText && displayStage === 'requirements' && <section className="border-b border-border/35 py-3.5">
          <div className="flex items-center gap-2 text-[11px] font-medium text-text-muted"><FileText className="h-3 w-3" />{t('common.objective', language)}</div>
          <p className="mt-2 whitespace-pre-wrap break-words text-[11px] font-medium leading-[18px] text-text-primary">{model.requestText}</p>
          {model.answeredClarification && <div className="mt-2.5 flex items-start gap-2 text-[11px] leading-4 text-text-muted"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" /><span>{model.answeredClarification.answers.join('、')}</span></div>}
        </section>}

        {model.clarification && displayStage === 'requirements' && <div className="py-3.5"><PlanWorkbenchQuestion language={language} content={model.clarification.content} onSubmit={submitClarification} /></div>}

        {plan && model.canStart && displayStage === 'plan' && <section className="mt-3">
          <div className="text-[11px] font-medium text-text-muted">{t('planWorkbench.planSummary', language)}</div>
          <div className="mt-2 grid grid-cols-3 divide-x divide-border/40 rounded-lg border border-border/45 bg-surface/[0.08] py-2.5 text-center">
            <div><strong className="block text-[11px] font-semibold tabular-nums text-text-primary">{model.review?.taskCount || 0}</strong><span className="mt-1 block text-[10px] text-text-muted">{t('common.tasks', language)}</span></div>
            <div><strong className="block text-[11px] font-semibold tabular-nums text-text-primary">{model.review?.maxParallelism || 0}</strong><span className="mt-1 block text-[10px] text-text-muted">{t('common.maxParallel', language)}</span></div>
            <div><strong className="block text-[11px] font-semibold tabular-nums text-text-primary">{model.review?.declaredArtifacts || 0}</strong><span className="mt-1 block text-[10px] text-text-muted">{t('planWorkbench.artifacts', language)}</span></div>
          </div>
          <dl className="mt-2 divide-y divide-border/35 border-y border-border/35 text-[11px]">
            <div className="flex items-center justify-between py-2"><dt className="flex items-center gap-1.5 text-text-muted"><GitBranch className="h-3 w-3" />{t('planWorkbench.strategy', language)}</dt><dd className="font-medium text-text-secondary">{plan.executionMode === 'parallel' ? (t('planWorkbench.parallel2', language)) : (t('planWorkbench.sequential2', language))}</dd></div>
            <div className="flex items-center justify-between py-2"><dt className="flex items-center gap-1.5 text-text-muted"><ShieldCheck className="h-3 w-3" />{t('planWorkbench.approvals', language)}</dt><dd className="font-medium text-text-secondary">{t('planWorkbench.perPermissionedTool', language)}</dd></div>
            <div className="flex items-center justify-between py-2"><dt className="flex items-center gap-1.5 text-text-muted"><Boxes className="h-3 w-3" />{t('planWorkbench.tokenBudget', language)}</dt><dd className="font-medium tabular-nums text-text-secondary">{model.review?.estimatedTokens ? model.review.estimatedTokens.toLocaleString() : '—'}</dd></div>
          </dl>
          {model.review && model.review.allocations.length > 0 && <div className="mt-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-text-muted"><UserRoundCog className="h-3 w-3" />{t('planWorkbench.roleAndModelAllocation', language)}</div>
            <div className="divide-y divide-border/30 rounded-lg border border-border/40">
              {model.review.allocations.map(item => <div key={item.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-2.5 py-2"><div className="min-w-0"><div className="truncate text-[11px] font-medium text-text-secondary">{item.role}</div><div className="mt-0.5 truncate text-[10px] text-text-muted">{providerConfigs[item.provider]?.displayName || BUILTIN_PROVIDERS[item.provider]?.displayName || item.provider} · {item.model}</div></div><span className="self-center text-[10px] tabular-nums text-text-muted">{item.taskCount} {t('planWorkbench.tasks2', language)}</span></div>)}
            </div>
          </div>}
          {model.review && <div className="mt-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-text-muted"><AlertTriangle className="h-3 w-3" />{t('planWorkbench.structuralChecks', language)}</div>
            {model.review.risks.length ? <div className="space-y-1.5">{model.review.risks.map(risk => <div key={risk.id} className={`rounded-md border px-2.5 py-2 ${risk.severity === 'error' ? 'border-red-400/25 bg-red-400/[0.035]' : 'border-amber-400/25 bg-amber-400/[0.035]'}`}><div className={`text-[10px] font-medium ${risk.severity === 'error' ? 'text-red-400' : 'text-amber-500'}`}>{t(`planReview.risk.${risk.code}.title`, language)}</div><div className="mt-1 text-[10px] leading-4 text-text-muted">{t(`planReview.risk.${risk.code}.detail`, language, planReviewRiskParams(risk, language))}</div></div>)}</div> : <div className="flex items-center gap-1.5 rounded-md border border-border/35 px-2.5 py-2 text-[10px] text-text-muted"><CheckCircle2 className="h-3 w-3 text-emerald-400" />{t('planWorkbench.noCyclesMissingDependencies', language)}</div>}
          </div>}
          <button onClick={startPlan} disabled={starting} className="mt-4 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-accent text-[10px] font-medium text-white shadow-sm hover:bg-accent-hover disabled:opacity-50">{starting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}{t('common.approveAndRun', language)}</button>
          <button onClick={revisePlan} className="mt-2 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-border/60 text-[10px] font-medium text-text-secondary hover:bg-surface-hover"><RotateCcw className="h-3.5 w-3.5" />{t('planWorkbench.returnToRevise', language)}</button>
          <p className="mt-2 text-center text-[10px] leading-4 text-text-muted/65">{t('planWorkbench.permissionedToolsStillRequest', language)}</p>
        </section>}

        {displayStage === 'execution' && <PlanWorkbenchRuntime items={model.tasks} completed={model.completedCount} language={language} onOpenThread={openThread} onApprove={approve} onReject={reject} />}

        {displayStage === 'validation' && model.stage === 'validation' && validation && <section className="mt-4 border-t border-border/40 pt-3.5">
          <div className="flex items-center gap-2 text-[11px] font-medium text-text-muted">{validation.failed > 0 ? <TriangleAlert className="h-3 w-3 text-amber-400" /> : <CheckCircle2 className="h-3 w-3 text-emerald-400" />}{t('planWorkbench.deliveryResult', language)}</div>
          <div className="mt-2 grid grid-cols-3 divide-x divide-border/40 border-y border-border/35 py-2.5 text-center">
            <div><div className="text-[11px] font-semibold tabular-nums text-text-primary">{model.completedCount}/{model.tasks.length}</div><div className="mt-1 text-[10px] text-text-muted">{t('common.tasks', language)}</div></div>
            <div><div className={`text-[11px] font-semibold tabular-nums ${validation.failed ? 'text-red-400' : 'text-text-primary'}`}>{validation.failed}</div><div className="mt-1 text-[10px] text-text-muted">{t('common.failed', language)}</div></div>
            <div><div className="text-[11px] font-semibold tabular-nums text-text-primary">{validation.duration ? formatElapsed(validation.duration) : '—'}</div><div className="mt-1 text-[10px] text-text-muted">{t('planWorkbench.elapsed', language)}</div></div>
          </div>
          {validation.files.length > 0 && <div className="mt-2 text-[10px] leading-4 text-text-muted">{t('planWorkbench.plannedResources', language, { length: validation.files.length })}</div>}
          {plan?.validation?.status === 'accepted' ? <div className="mt-3 flex items-center gap-2 rounded-md border border-emerald-400/25 bg-emerald-400/[0.04] px-3 py-2.5 text-[11px] font-medium text-emerald-500"><CheckCircle2 className="h-3.5 w-3.5" />{t('planWorkbench.resultsAcceptedAndSaved', language)}</div> : <div className="mt-3 grid grid-cols-2 gap-2">
            <button onClick={requestValidationChanges} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border/60 text-[11px] font-medium text-text-secondary hover:bg-surface-hover"><MessageSquareText className="h-3 w-3" />{t('common.requestChanges', language)}</button>
            <button onClick={acceptValidation} disabled={validation.failed > 0} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-accent text-[11px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"><Check className="h-3 w-3" />{t('planWorkbench.acceptResults', language)}</button>
          </div>}
          {validation.failed > 0 && plan?.validation?.status !== 'accepted' && <p className="mt-2 text-[10px] leading-4 text-amber-500">{t('planWorkbench.resolveOrRerunFailed', language)}</p>}
        </section>}

        {!model.isProcessing && displayStage === 'requirements' && <PlanWorkbenchActivity activities={model.activities.filter(activity => activity.stage === 'requirements')} language={language} />}
      </div>
    </div>
    <PlanHistoryDrawer open={historyOpen} entries={history} language={language} onClose={() => setHistoryOpen(false)} onSelect={openHistoryEntry} onDelete={deleteHistoryEntry} onCreateNew={createNewPlan} />
  </div>
})

export default PlanWorkbench
