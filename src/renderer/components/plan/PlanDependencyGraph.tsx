import { memo, useMemo } from 'react'
import {
  AlertTriangle, CheckCircle2, Circle, Clock3, FileCode2, LoaderCircle, ShieldAlert, UserRoundCog, XCircle, } from 'lucide-react'
import type { PlanTask } from '@/renderer/agent/plan/types'
import { layoutPlanGraph } from '@/renderer/agent/plan/planGraphLayout'
import { OtterAsset } from '@/renderer/components/brand/OtterAsset'
import { t, type Language } from '@shared/i18n'

export interface PlanDependencyGraphProps {
  tasks: PlanTask[]
  selectedTaskId?: string | null
  waitingApprovalTaskIds?: ReadonlySet<string>
  language: Language
  onSelectTask: (taskId: string) => void
}

function taskState(task: PlanTask, waitingApproval: boolean, language: Language) {
  if (waitingApproval) return { label: t('planDependencyGraph.approvalRequired', language), icon: ShieldAlert, tone: 'text-amber-500', ring: 'border-amber-400/45' }
  if (task.status === 'completed') return { label: t('common.completed', language), icon: CheckCircle2, tone: 'text-emerald-500', ring: 'border-emerald-400/35' }
  if (task.status === 'running') return { label: t('common.running', language), icon: LoaderCircle, tone: 'text-accent', ring: 'border-accent/45' }
  if (task.status === 'failed') return { label: t('planDependencyGraph.failed', language), icon: AlertTriangle, tone: 'text-red-400', ring: 'border-red-400/40' }
  if (task.status === 'skipped' || task.status === 'cancelled') return { label: t('common.skipped', language), icon: XCircle, tone: 'text-text-muted', ring: 'border-border/70' }
  return { label: t('planDependencyGraph.queued', language), icon: Circle, tone: 'text-text-muted', ring: 'border-border/70' }
}

function formatDuration(task: PlanTask): string | null {
  if (!task.startedAt) return null
  const elapsed = Math.max(0, (task.completedAt || Date.now()) - task.startedAt)
  const seconds = Math.floor(elapsed / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function edgePath(points: Array<{ x: number, y: number }>): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
}

export const PlanDependencyGraph = memo(function PlanDependencyGraph({
  tasks,
  selectedTaskId,
  waitingApprovalTaskIds = new Set<string>(),
  language,
  onSelectTask,
}: PlanDependencyGraphProps) {
  const layout = useMemo(() => layoutPlanGraph(tasks), [tasks])

  if (!tasks.length) return <div className="flex min-h-[320px] flex-col items-center justify-center text-[11px] text-text-muted">
    <OtterAsset asset="idlePaws" className="mb-3 h-16 w-16 object-contain opacity-80" />
    {t('planDependencyGraph.noTasksInThis', language)}
  </div>

  return <div className="relative min-h-0 flex-1 overflow-auto bg-[radial-gradient(circle_at_1px_1px,rgb(var(--color-border)/0.22)_1px,transparent_0)] bg-[size:20px_20px] custom-scrollbar">
    {(layout.hasCycle || layout.missingDependencies.length > 0) && <div className="sticky left-4 top-3 z-30 mx-4 flex w-fit max-w-[640px] items-center gap-2 rounded-md border border-amber-400/30 bg-background/95 px-3 py-2 text-[11px] text-amber-500 shadow-sm backdrop-blur">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span>{layout.hasCycle
        ? t('planDependencyGraph.thePlanContainsA', language)
        : t('planDependencyGraph.dependenciesReferenceMissingTasks', language, { length: layout.missingDependencies.length })}</span>
    </div>}
    <div className="relative" style={{ width: layout.width, height: layout.height }}>
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
        <defs>
          <marker id="plan-edge-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8 z" className="fill-border" />
          </marker>
        </defs>
        {layout.edges.map(edge => <path key={edge.id} d={edgePath(edge.points)} fill="none" className="stroke-border/80" strokeWidth="1.25" strokeLinejoin="round" markerEnd="url(#plan-edge-arrow)" />)}
      </svg>

      {layout.nodes.map((node, index) => {
        const task = node.task
        const meta = taskState(task, waitingApprovalTaskIds.has(task.id), language)
        const Icon = meta.icon
        const selected = selectedTaskId === task.id
        const duration = formatDuration(task)
        const dependencyTitles = task.dependencies.map(id => tasks.find(item => item.id === id)?.title || id)
        return <button
          key={task.id}
          type="button"
          onClick={() => onSelectTask(task.id)}
          aria-pressed={selected}
          className={`absolute overflow-hidden rounded-xl border bg-background/95 text-left shadow-[0_8px_28px_rgba(15,23,42,0.035)] transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-accent/35 hover:shadow-[0_12px_32px_rgba(15,23,42,0.06)] ${selected ? 'border-accent/55 ring-2 ring-accent/10' : meta.ring}`}
          style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
        >
          <div className="flex h-full flex-col px-4 py-3.5">
            <div className="flex items-start gap-3">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-background text-[10px] font-semibold tabular-nums ${selected ? 'border-accent/45 text-accent' : 'border-border/80 text-text-secondary'}`}>{index + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="line-clamp-1 text-[11px] font-semibold leading-5 text-text-primary">{task.title}</h3>
                  <span className={`flex shrink-0 items-center gap-1 text-[10px] font-medium ${meta.tone}`}><Icon className={`h-3 w-3 ${task.status === 'running' && !waitingApprovalTaskIds.has(task.id) ? 'animate-spin' : ''}`} />{meta.label}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-text-muted">{task.description}</p>
              </div>
            </div>

            <div className="mt-auto grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-border/45 pt-2.5 text-[10px]">
              <span className="flex min-w-0 items-center gap-1.5 text-text-muted"><UserRoundCog className="h-3 w-3 shrink-0" /><span className="truncate">{task.role || t('planDependencyGraph.defaultRole', language)}</span></span>
              <span className="flex min-w-0 items-center gap-1.5 text-text-muted"><Clock3 className="h-3 w-3 shrink-0" /><span className="truncate">{duration || (task.estimatedTokens ? `${task.estimatedTokens.toLocaleString()} tokens` : t('planDependencyGraph.notEstimated', language))}</span></span>
              <span className="flex min-w-0 items-center gap-1.5 text-text-muted"><FileCode2 className="h-3 w-3 shrink-0" /><span className="truncate">{task.producesFiles?.length ? task.producesFiles.join('、') : t('planDependencyGraph.noDeclaredArtifact', language)}</span></span>
              <span className="truncate text-text-muted" title={dependencyTitles.join('、')}>{task.dependencies.length ? `${t('common.depends', language)} ${dependencyTitles.join('、')}` : t('planDependencyGraph.startingTask', language)}</span>
            </div>
          </div>
        </button>
      })}
    </div>
  </div>
})

export default PlanDependencyGraph
