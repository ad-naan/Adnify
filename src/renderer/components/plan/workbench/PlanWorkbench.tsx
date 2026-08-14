import { memo, useState } from 'react'
import { History, Play } from 'lucide-react'
import type { PlanActivityStatus, PlanWorkbenchStage } from '@/renderer/agent/plan/planWorkbenchProjection'
import { PlanWorkbenchActivity } from './PlanWorkbenchActivity'
import { PlanWorkbenchApproval } from './PlanWorkbenchApproval'
import { PlanWorkbenchRuntime } from './PlanWorkbenchRuntime'
import { PlanWorkbenchQuestion } from './PlanWorkbenchQuestion'
import { usePlanWorkbenchController } from './usePlanWorkbenchController'
import { PlanWorkbenchEmpty } from './PlanWorkbenchEmpty'
import { PlanHistoryDrawer } from './PlanHistoryDrawer'

const stageLabel = (stage: PlanWorkbenchStage, language: string) => ({
  requirements: language === 'zh' ? '需求确认' : 'Requirements',
  plan: language === 'zh' ? '计划审阅' : 'Plan review',
  execution: language === 'zh' ? '执行中' : 'Execution',
  validation: language === 'zh' ? '结果验收' : 'Validation',
})[stage]

const focusDot = (tone: PlanActivityStatus) => {
  if (tone === 'blocked') return 'bg-red-400'
  if (tone === 'warning') return 'bg-amber-400'
  if (tone === 'completed') return 'bg-green-500'
  return 'bg-accent'
}

export const PlanWorkbench = memo(function PlanWorkbench() {
  const { language, plan, model, history, starting, startPlan, submitClarification, approve, reject, openThread, openHistoryEntry } = usePlanWorkbenchController()
  const [historyOpen, setHistoryOpen] = useState(false)

  if (!model.hasSession) return <div className="relative h-full"><PlanWorkbenchEmpty language={language} recent={history} onOpenHistory={() => setHistoryOpen(true)} onSelectHistory={openHistoryEntry} /><PlanHistoryDrawer open={historyOpen} entries={history} language={language} onClose={() => setHistoryOpen(false)} onSelect={openHistoryEntry} /></div>

  return <div className="relative h-full min-h-0">
    {history.length > 0 && <button onClick={() => setHistoryOpen(true)} title={language === 'zh' ? '计划历史' : 'Plan history'} className="absolute right-3 top-3 z-10 rounded-md border border-border/45 bg-background/80 p-1.5 text-text-muted shadow-sm backdrop-blur hover:bg-surface-hover hover:text-text-primary"><History className="h-3.5 w-3.5" /></button>}
    <div className="h-full overflow-y-auto custom-scrollbar">
    <div className="mx-auto w-full max-w-[560px] px-4 pb-5 pt-4">
      {model.focus && <section className="rounded-xl border border-border/55 bg-surface/[0.14] px-3.5 py-3">
        <div className="flex items-center gap-2 text-[9px] font-medium text-text-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${focusDot(model.focus.tone)} ${model.focus.tone === 'active' ? 'animate-pulse' : ''}`} />
          <span>{stageLabel(model.focus.stage, language)}</span>
          {model.focus.progress !== undefined && <span className="ml-auto tabular-nums">{model.focus.progress}%</span>}
        </div>
        <div className="mt-2 text-[12px] font-semibold leading-5 text-text-primary">{model.focus.title}</div>
        {model.focus.detail && <p className="mt-1 text-[10px] leading-[17px] text-text-muted">{model.focus.detail}</p>}
        {plan && <div className="mt-3 h-0.5 overflow-hidden rounded-full bg-text-primary/[0.05]"><div className="h-full bg-accent/70 transition-[width]" style={{ width: `${model.progress}%` }} /></div>}
      </section>}

      {model.requestText && model.stage === 'requirements' && <section className={`${model.focus ? 'mt-4' : ''} rounded-xl border border-border/50 bg-surface/[0.08] px-3.5 py-3`}>
        <div className="flex items-center justify-between gap-3"><span className="text-[9px] font-medium text-text-muted">{language === 'zh' ? '你的请求' : 'Your request'}</span>{model.requestTimestamp && <span className="text-[8px] text-text-muted/60">{new Date(model.requestTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}</div>
        <p className="mt-2 whitespace-pre-wrap break-words text-[12px] font-medium leading-[19px] text-text-primary">{model.requestText}</p>
        <div className="mt-2.5 border-t border-border/35 pt-2 text-[8px] text-text-muted">{model.clarification ? (language === 'zh' ? '已接收 · 等待需求确认' : 'Received · clarification required') : (language === 'zh' ? '已接收' : 'Received')}</div>
      </section>}

      {model.clarification && <div className="mt-4"><PlanWorkbenchQuestion language={language} content={model.clarification.content} onSubmit={submitClarification} /></div>}

      {plan && model.canStart && <section className="mt-4 rounded-xl border border-border/55 bg-surface/[0.1] p-3.5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-semibold text-text-primary">{plan.name}</div>
            <div className="mt-1 text-[9px] text-text-muted">{model.tasks.length} {language === 'zh' ? '项任务' : 'tasks'} · {plan.executionMode === 'parallel' ? (language === 'zh' ? '并行调度' : 'parallel') : (language === 'zh' ? '顺序调度' : 'sequential')}</div>
          </div>
          <button onClick={startPlan} disabled={starting} className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-[10px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"><Play className="h-3 w-3" />{starting ? (language === 'zh' ? '启动中' : 'Starting') : (language === 'zh' ? '开始执行' : 'Run')}</button>
        </div>
      </section>}

      <PlanWorkbenchApproval items={model.approvals} language={language} onApprove={approve} onReject={reject} />
      <PlanWorkbenchRuntime items={model.stage === 'execution' || model.stage === 'validation' ? model.tasks : []} completed={model.completedCount} language={language} onOpenThread={openThread} />
      <PlanWorkbenchActivity activities={model.activities} language={language} />
    </div>
    </div>
    <PlanHistoryDrawer open={historyOpen} entries={history} language={language} onClose={() => setHistoryOpen(false)} onSelect={openHistoryEntry} />
  </div>
})

export default PlanWorkbench
