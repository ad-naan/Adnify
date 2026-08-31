import {
  AlertTriangle, BarChart3, Check, CheckCircle2, Circle, FileOutput,
  ListChecks, LoaderCircle, ShieldCheck, Signpost,
} from 'lucide-react'
import type { PlanStageContent, PlanStageContentItem, PlanStageSectionKind } from '@/renderer/agent/plan/types'

const sectionIcons: Record<PlanStageSectionKind, typeof Circle> = {
  overview: Signpost,
  list: ListChecks,
  checklist: CheckCircle2,
  decisions: ShieldCheck,
  risks: AlertTriangle,
  deliverables: FileOutput,
  metrics: BarChart3,
}

function ItemState({ status }: { status?: PlanStageContentItem['status'] }) {
  if (status === 'active') return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-accent" />
  if (status === 'completed' || status === 'confirmed') return <Check className="h-3.5 w-3.5 text-emerald-500" />
  if (status === 'warning' || status === 'blocked') return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
  return <Circle className="h-3.5 w-3.5 text-text-muted/55" />
}

export function PlanStageContentView({ content, compact = false, hideHeader = false }: {
  content: PlanStageContent
  compact?: boolean
  hideHeader?: boolean
}) {
  return <div className="min-w-0">
    {!hideHeader && <header className={compact ? 'pb-3' : 'border-b border-border/45 pb-5'}>
      <h2 className={compact ? 'text-[13px] font-semibold text-text-primary' : 'text-[18px] font-semibold text-text-primary'}>{content.title}</h2>
      <p className={`mt-1.5 text-text-secondary ${compact ? 'text-[10px] leading-4' : 'max-w-4xl text-[12px] leading-6'}`}>{content.summary}</p>
    </header>}
    <div className={compact ? 'space-y-2.5' : 'mt-5 space-y-3'}>
      {content.sections.map(section => {
        const Icon = sectionIcons[section.kind]
        return <section key={section.id} className={`overflow-hidden rounded-xl border border-border/55 bg-surface/[0.07] ${compact ? '' : 'shadow-[0_1px_0_rgba(0,0,0,0.02)]'}`}>
          <div className={`flex items-start gap-3 border-b border-border/40 ${compact ? 'px-3 py-2.5' : 'px-4 py-3.5'}`}>
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/[0.075] text-accent"><Icon className="h-3.5 w-3.5" /></span>
            <div className="min-w-0"><h3 className={`${compact ? 'text-[10px]' : 'text-[12px]'} font-semibold text-text-primary`}>{section.title}</h3>{section.description && <p className={`mt-1 text-text-muted ${compact ? 'text-[11px] leading-4' : 'text-[10px] leading-5'}`}>{section.description}</p>}</div>
          </div>
          {section.items.length > 0 && <div className="divide-y divide-border/35">
            {section.items.map(item => <div key={item.id} className={`flex items-start gap-3 ${compact ? 'px-3 py-2.5' : 'px-4 py-3'}`}>
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center"><ItemState status={item.status} /></span>
              <div className="min-w-0 flex-1"><div className={`${compact ? 'text-[10px]' : 'text-[11px]'} font-medium text-text-secondary`}>{item.title}</div>{item.description && <p className={`mt-1 text-text-muted ${compact ? 'text-[11px] leading-4' : 'text-[10px] leading-5'}`}>{item.description}</p>}</div>
            </div>)}
          </div>}
        </section>
      })}
    </div>
  </div>
}
