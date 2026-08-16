import { memo, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, FileText, History, LoaderCircle, Play, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { PlanActivityStatus, PlanWorkbenchFocus } from '@/renderer/agent/plan/planWorkbenchProjection'
import { PlanStageTrace } from '@/renderer/components/plan/PlanStageTrace'
import { PlanWorkbenchActivity } from './PlanWorkbenchActivity'
import { PlanWorkbenchRuntime } from './PlanWorkbenchRuntime'
import { PlanWorkbenchQuestion } from './PlanWorkbenchQuestion'
import { usePlanWorkbenchController } from './usePlanWorkbenchController'
import { PlanWorkbenchEmpty } from './PlanWorkbenchEmpty'
import { PlanHistoryDrawer } from './PlanHistoryDrawer'

const focusDot = (tone: PlanActivityStatus) => {
  if (tone === 'blocked') return 'bg-red-400'
  if (tone === 'warning') return 'bg-amber-400'
  if (tone === 'completed') return 'bg-green-500'
  return 'bg-accent'
}

const panelTitle = (stage: string, language: string) => ({
  requirements: language === 'zh' ? '需求审阅' : 'Requirement review',
  plan: language === 'zh' ? '计划审阅' : 'Plan review',
  execution: language === 'zh' ? '运行中心' : 'Run center',
  validation: language === 'zh' ? '结果审阅' : 'Result review',
})[stage] || (language === 'zh' ? 'Plan 模式' : 'Plan mode')

function formatElapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export const PlanWorkbench = memo(function PlanWorkbench() {
  const { language, plan, model, history, starting, startPlan, submitClarification, approve, reject, openThread, openHistoryEntry, deleteHistoryEntry } = usePlanWorkbenchController()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

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
        ? (language === 'zh' ? '正在生成结构化计划' : 'Creating the structured plan')
        : (language === 'zh' ? '正在整理下一步动作' : 'Preparing the next action'),
      detail: model.planningState === 'ready_to_create'
        ? (language === 'zh' ? '已确认的需求正在转换为任务、依赖与执行配置' : 'Confirmed requirements are becoming tasks and dependencies')
        : (language === 'zh' ? '模型与工具动作会在这里持续更新' : 'Model and tool activity updates continuously'),
      tone: 'active',
    }
    if (plan && model.canStart && !model.isProcessing) return {
      stage: 'plan',
      title: language === 'zh' ? '计划已准备好' : 'Plan is ready',
      detail: `${model.tasks.length} ${language === 'zh' ? '项任务' : 'tasks'} · ${plan.executionMode === 'parallel' ? (language === 'zh' ? '并行调度' : 'parallel') : (language === 'zh' ? '顺序调度' : 'sequential')}`,
      tone: 'info',
    }
    if (plan?.status === 'completed') return {
      stage: 'validation',
      title: language === 'zh' ? '执行完成，等待验收' : 'Execution complete',
      detail: `${model.completedCount}/${model.tasks.length} ${language === 'zh' ? '项任务完成' : 'tasks completed'}`,
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

  if (!model.hasSession) return <div className="relative h-full bg-background">
    <div className="absolute right-3 top-3 z-10">
      {history.length > 0 && <button onClick={() => setHistoryOpen(true)} aria-label={language === 'zh' ? '计划历史' : 'Plan history'} className="rounded-md p-1.5 text-text-muted hover:bg-surface-hover hover:text-text-primary"><History className="h-3.5 w-3.5" /></button>}
    </div>
    <PlanWorkbenchEmpty language={language} recent={history} onOpenHistory={() => setHistoryOpen(true)} onSelectHistory={openHistoryEntry} />
    <PlanHistoryDrawer open={historyOpen} entries={history} language={language} onClose={() => setHistoryOpen(false)} onSelect={openHistoryEntry} onDelete={deleteHistoryEntry} />
  </div>

  return <div className="relative flex h-full min-h-0 flex-col bg-background">
    <header className="shrink-0 border-b border-border/45 px-3.5 pb-3 pt-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[11px] font-semibold text-text-primary">{panelTitle(model.stage, language)}</div>
          <div className="mt-1 text-[8px] text-text-muted">{plan?.name || (language === 'zh' ? '正在形成需求简报' : 'Building the brief')}</div>
        </div>
        {history.length > 0 && <button onClick={() => setHistoryOpen(true)} aria-label={language === 'zh' ? '计划历史' : 'Plan history'} className="rounded-md p-1.5 text-text-muted hover:bg-surface-hover hover:text-text-primary"><History className="h-3.5 w-3.5" /></button>}
      </div>
      <div className="mt-3"><PlanStageTrace stage={model.stage} language={language} /></div>
    </header>

    <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
      <div className="px-3.5 pb-5 pt-3.5">
        {visibleFocus && <section className="border-b border-border/40 pb-3.5">
          <div className="flex items-center gap-2 text-[8px] font-medium text-text-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${focusDot(visibleFocus.tone)} ${visibleFocus.tone === 'active' ? 'animate-pulse' : ''}`} />
            <span>{visibleFocus.tone === 'warning' ? (language === 'zh' ? '需要处理' : 'Attention') : visibleFocus.tone === 'completed' ? (language === 'zh' ? '已完成' : 'Complete') : (language === 'zh' ? '当前焦点' : 'Current focus')}</span>
            <span className="ml-auto tabular-nums">{model.isProcessing ? `${elapsedSeconds}s` : visibleFocus.progress !== undefined ? `${visibleFocus.progress}%` : ''}</span>
          </div>
          <div className={`mt-2 text-[12px] font-semibold leading-5 text-text-primary ${visibleFocus.tone === 'active' ? 'tool-text-shimmer' : ''}`}>{visibleFocus.title}</div>
          {visibleFocus.detail && <p className="mt-1 text-[9px] leading-[16px] text-text-muted">{visibleFocus.detail}</p>}
          {model.isProcessing && <div className="mt-3 h-px overflow-hidden bg-border/45"><div className="h-full w-1/3 animate-pulse bg-accent/75" /></div>}
        </section>}

        {model.requestText && !plan && <section className="border-b border-border/35 py-3.5">
          <div className="flex items-center gap-2 text-[9px] font-medium text-text-muted"><FileText className="h-3 w-3" />{language === 'zh' ? '本次目标' : 'Objective'}</div>
          <p className="mt-2 whitespace-pre-wrap break-words text-[11px] font-medium leading-[18px] text-text-primary">{model.requestText}</p>
          {model.answeredClarification && <div className="mt-2.5 flex items-start gap-2 text-[9px] leading-4 text-text-muted"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" /><span>{model.answeredClarification.answers.join('、')}</span></div>}
        </section>}

        {model.clarification && <div className="py-3.5"><PlanWorkbenchQuestion language={language} content={model.clarification.content} onSubmit={submitClarification} /></div>}

        {plan && model.canStart && <section className="mt-3">
          <div className="text-[9px] font-medium text-text-muted">{language === 'zh' ? '计划摘要' : 'Plan summary'}</div>
          <dl className="mt-2 divide-y divide-border/35 border-y border-border/35 text-[9px]">
            <div className="flex items-center justify-between py-2"><dt className="text-text-muted">{language === 'zh' ? '执行策略' : 'Strategy'}</dt><dd className="font-medium text-text-secondary">{plan.executionMode === 'parallel' ? (language === 'zh' ? '并行执行' : 'Parallel') : (language === 'zh' ? '顺序执行' : 'Sequential')}</dd></div>
            <div className="flex items-center justify-between py-2"><dt className="text-text-muted">{language === 'zh' ? '任务数量' : 'Tasks'}</dt><dd className="font-medium tabular-nums text-text-secondary">{plan.tasks.length}</dd></div>
            <div className="flex items-center justify-between py-2"><dt className="text-text-muted">{language === 'zh' ? '审批策略' : 'Approvals'}</dt><dd className="inline-flex items-center gap-1 font-medium text-emerald-400"><ShieldCheck className="h-3 w-3" />{language === 'zh' ? '按需询问' : 'Ask when needed'}</dd></div>
          </dl>
          <button onClick={startPlan} disabled={starting} className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-accent text-[10px] font-medium text-white hover:bg-accent-hover disabled:opacity-50">{starting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}{language === 'zh' ? '批准并执行' : 'Approve and run'}</button>
          <p className="mt-2 text-center text-[8px] leading-4 text-text-muted/65">{language === 'zh' ? '需要权限的工具仍会逐项请求审批' : 'Permissioned tools still request approval'}</p>
        </section>}

        {(model.stage === 'execution' || model.stage === 'validation') && <PlanWorkbenchRuntime items={model.tasks} completed={model.completedCount} language={language} onOpenThread={openThread} onApprove={approve} onReject={reject} />}

        {model.stage === 'validation' && validation && <section className="mt-4 border-t border-border/40 pt-3.5">
          <div className="flex items-center gap-2 text-[9px] font-medium text-text-muted">{validation.failed > 0 ? <TriangleAlert className="h-3 w-3 text-amber-400" /> : <CheckCircle2 className="h-3 w-3 text-emerald-400" />}{language === 'zh' ? '交付结果' : 'Delivery result'}</div>
          <div className="mt-2 grid grid-cols-3 divide-x divide-border/40 border-y border-border/35 py-2.5 text-center">
            <div><div className="text-[11px] font-semibold tabular-nums text-text-primary">{model.completedCount}/{model.tasks.length}</div><div className="mt-1 text-[8px] text-text-muted">{language === 'zh' ? '任务' : 'Tasks'}</div></div>
            <div><div className={`text-[11px] font-semibold tabular-nums ${validation.failed ? 'text-red-400' : 'text-text-primary'}`}>{validation.failed}</div><div className="mt-1 text-[8px] text-text-muted">{language === 'zh' ? '失败' : 'Failed'}</div></div>
            <div><div className="text-[11px] font-semibold tabular-nums text-text-primary">{validation.duration ? formatElapsed(validation.duration) : '—'}</div><div className="mt-1 text-[8px] text-text-muted">{language === 'zh' ? '耗时' : 'Elapsed'}</div></div>
          </div>
          {validation.files.length > 0 && <div className="mt-2 text-[8px] leading-4 text-text-muted">{language === 'zh' ? `涉及 ${validation.files.length} 个计划资源` : `${validation.files.length} planned resources`}</div>}
        </section>}

        <PlanWorkbenchActivity activities={model.activities} language={language} />
      </div>
    </div>
    <PlanHistoryDrawer open={historyOpen} entries={history} language={language} onClose={() => setHistoryOpen(false)} onSelect={openHistoryEntry} onDelete={deleteHistoryEntry} />
  </div>
})

export default PlanWorkbench
