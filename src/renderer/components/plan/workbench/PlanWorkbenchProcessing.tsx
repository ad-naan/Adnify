import { CheckCircle2, Circle, LoaderCircle, Sparkles } from 'lucide-react'
import type { PlanActivityItem, PlanWorkbenchStage } from '@/renderer/agent/plan/planWorkbenchProjection'
import type { PlanPlanningState } from '@/renderer/agent/plan/planWorkflowGuard'
import { t, type Language } from '@shared/i18n'

const phaseCopy: Record<PlanPlanningState, { zh: string, en: string, zhDetail: string, enDetail: string }> = {
  needs_clarification: { zh: '正在梳理需求与项目上下文', en: 'Reviewing requirements and project context', zhDetail: '正在识别目标、约束和需要确认的关键决策', enDetail: 'Identifying goals, constraints, and decisions that need confirmation' },
  waiting_for_answer: { zh: '等待你确认关键需求', en: 'Waiting for requirement confirmation', zhDetail: '收到回答后会继续生成结构化计划', enDetail: 'The structured plan will continue after your response' },
  ready_to_create: { zh: '正在生成结构化计划', en: 'Creating the structured plan', zhDetail: '正在组织任务、依赖关系、角色模型与验收标准', enDetail: 'Organizing tasks, dependencies, role assignments, and acceptance criteria' },
  revision_requested: { zh: '正在分析计划调整范围', en: 'Analyzing the requested revision', zhDetail: '正在定位受影响的任务、依赖和阶段内容', enDetail: 'Locating affected tasks, dependencies, and stage content' },
  ready_to_update: { zh: '正在更新计划版本', en: 'Updating the plan version', zhDetail: '正在合并确认结果并重建受影响的计划内容', enDetail: 'Merging confirmed changes and rebuilding affected plan content' },
  plan_created: { zh: '计划已经生成', en: 'Plan created', zhDetail: '正在同步计划看板与审阅信息', enDetail: 'Synchronizing the plan board and review details' },
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
  const copy = stage === 'execution'
    ? { zh: '正在执行计划任务', en: 'Executing plan tasks', zhDetail: '任务状态、工具动作、子代理与审批请求会持续更新', enDetail: 'Task state, tool activity, sub-agents, and approvals update continuously' }
    : stage === 'validation'
      ? { zh: '正在整理验收结果', en: 'Preparing validation results', zhDetail: '正在汇总任务结果、产出物、失败项与验证结论', enDetail: 'Collecting task results, artifacts, failures, and validation findings' }
      : phaseCopy[planningState]
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
          <h2 className={`text-[12px] font-semibold text-text-primary ${waiting ? '' : 'tool-text-shimmer'}`}>{language === 'zh' ? copy.zh : copy.en}</h2>
          <time className="shrink-0 text-[11px] tabular-nums text-text-muted">{elapsedSeconds}s</time>
        </div>
        <p className="mt-1.5 text-[10px] leading-5 text-text-muted">{language === 'zh' ? copy.zhDetail : copy.enDetail}</p>
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
