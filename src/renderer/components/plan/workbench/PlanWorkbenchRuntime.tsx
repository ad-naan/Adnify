import { ExternalLink } from 'lucide-react'
import type { PlanTaskRuntimeItem } from '@/renderer/agent/plan/planWorkbenchProjection'

const statusDot = (item: PlanTaskRuntimeItem) => {
  if (item.waitingApproval) return 'bg-amber-400'
  if (item.task.status === 'running') return 'bg-accent'
  if (item.task.status === 'completed') return 'bg-green-500'
  if (item.task.status === 'failed') return 'bg-red-400'
  return 'bg-text-muted/35'
}

interface Props {
  items: PlanTaskRuntimeItem[]
  completed: number
  language: string
  onOpenThread: (threadId: string) => void
}

export function PlanWorkbenchRuntime({ items, completed, language, onOpenThread }: Props) {
  if (!items.length) return null

  return <section className="mt-5">
    <div className="mb-2 flex items-center justify-between px-0.5 text-[10px] text-text-muted">
      <span>{language === 'zh' ? '任务运行' : 'Task runtime'}</span>
      <span className="tabular-nums">{completed}/{items.length}</span>
    </div>
    <div className="divide-y divide-border/40 overflow-hidden rounded-xl border border-border/55 bg-surface/[0.08]">
      {items.map(item => <button key={item.task.id} disabled={!item.task.threadId} onClick={() => item.task.threadId && onOpenThread(item.task.threadId)} className="flex w-full items-start gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-hover/45 disabled:cursor-default">
        <span className={`mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(item)} ${item.task.status === 'running' && !item.waitingApproval ? 'animate-pulse' : ''}`} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[10px] font-medium text-text-secondary">{item.task.title}</div>
          <div className="mt-1 truncate text-[9px] text-text-muted">{item.currentToolName || item.latestText || item.task.description}</div>
        </div>
        {item.task.threadId && <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-text-muted/70" />}
      </button>)}
    </div>
  </section>
}
