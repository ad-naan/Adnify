import type { PlanWorkbenchStage } from '@/renderer/agent/plan/planWorkbenchProjection'

const STAGES: PlanWorkbenchStage[] = ['requirements', 'plan', 'execution', 'validation']

const label = (stage: PlanWorkbenchStage, language: string) => ({
  requirements: language === 'zh' ? '需求' : 'Brief',
  plan: language === 'zh' ? '计划' : 'Plan',
  execution: language === 'zh' ? '执行' : 'Run',
  validation: language === 'zh' ? '验收' : 'Validate',
})[stage]

export function PlanStageTrace({ stage, language, compact = false }: {
  stage: PlanWorkbenchStage
  language: string
  compact?: boolean
}) {
  const activeIndex = STAGES.indexOf(stage)

  return <div className={`flex min-w-0 items-center ${compact ? 'gap-1' : 'gap-1.5'}`} aria-label={language === 'zh' ? '计划阶段' : 'Plan stages'}>
    {STAGES.map((item, index) => <div key={item} className="contents">
      <span className={`inline-flex shrink-0 items-center gap-1.5 text-[9px] font-medium ${index === activeIndex ? 'text-accent' : index < activeIndex ? 'text-text-secondary' : 'text-text-muted/55'}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${index <= activeIndex ? (index === activeIndex ? 'bg-accent ring-[3px] ring-accent/10' : 'bg-text-secondary/55') : 'bg-text-muted/25'}`} />
        {!compact && label(item, language)}
      </span>
      {index < STAGES.length - 1 && <span className={`h-px min-w-2 flex-1 ${index < activeIndex ? 'bg-text-secondary/25' : 'bg-border/60'}`} />}
    </div>)}
  </div>
}

