import { Fragment } from 'react'
import type { PlanWorkbenchStage } from '@/renderer/agent/plan/planWorkbenchProjection'
import { Check } from 'lucide-react'

const STAGES: PlanWorkbenchStage[] = ['requirements', 'plan', 'execution', 'validation']

const label = (stage: PlanWorkbenchStage, language: string) => ({
  requirements: language === 'zh' ? '需求' : 'Brief',
  plan: language === 'zh' ? '计划' : 'Plan',
  execution: language === 'zh' ? '执行' : 'Run',
  validation: language === 'zh' ? '验收' : 'Validate',
})[stage]

interface PlanStageTraceProps {
  /** The authoritative lifecycle stage. */
  stage: PlanWorkbenchStage
  /** The page currently displayed by the board. */
  selectedStage?: PlanWorkbenchStage
  language: string
  compact?: boolean
  onStageChange?: (stage: PlanWorkbenchStage) => void
}

export function PlanStageTrace({ stage, selectedStage = stage, language, compact = false, onStageChange }: PlanStageTraceProps) {
  const activeIndex = STAGES.indexOf(stage)

  return <nav className={`flex min-w-0 items-center ${compact ? 'gap-1' : 'gap-2'}`} aria-label={language === 'zh' ? '计划阶段' : 'Plan stages'}>
    {STAGES.map((item, index) => {
      const completed = index < activeIndex
      const current = index === activeIndex
      const selected = item === selectedStage
      const textTone = selected ? 'text-accent' : current ? 'text-text-primary' : completed ? 'text-text-secondary' : 'text-text-muted/55'

      return <Fragment key={item}>
        <button
          type="button"
          aria-current={selected ? 'page' : undefined}
          onClick={() => onStageChange?.(item)}
          disabled={!onStageChange}
          className={`group inline-flex shrink-0 items-center gap-2 rounded-md px-1 py-1 text-[10px] font-medium transition-colors disabled:cursor-default ${textTone} ${onStageChange ? 'hover:bg-surface-hover/55 hover:text-text-primary' : ''}`}
        >
          <span className={`relative flex h-4 w-4 items-center justify-center rounded-full transition-all ${
            current
              ? 'bg-accent text-white ring-[3px] ring-accent/10'
              : completed
                ? 'bg-accent/10 text-accent'
                : 'border border-border/65 bg-background text-transparent'
          } ${selected && !current ? 'ring-2 ring-accent/20' : ''}`}>
            {completed && <Check className="h-2.5 w-2.5" strokeWidth={2.5} />}
            {current && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
          </span>
          {!compact && label(item, language)}
        </button>
        {index < STAGES.length - 1 && <span className={`h-px min-w-5 flex-1 ${index < activeIndex ? 'bg-accent/25' : 'bg-border/70'}`} />}
      </Fragment>
    })}
  </nav>
}
