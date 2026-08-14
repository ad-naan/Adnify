import { ExternalLink, LoaderCircle } from 'lucide-react'
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
        {item.task.status === 'running' && !item.waitingApproval
          ? <LoaderCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
          : <span className={`mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(item)} ${item.waitingApproval ? 'animate-pulse' : ''}`} />}
        <div className="min-w-0 flex-1">
          <div className={`truncate text-[10px] font-medium text-text-secondary ${item.task.status === 'running' && !item.waitingApproval ? 'tool-text-shimmer' : ''}`}>{item.task.title}</div>
          <div className="mt-1 truncate text-[9px] text-text-muted">{item.waitingApproval ? (language === 'zh' ? '等待工具审批' : 'Waiting for approval') : (item.currentToolName || item.latestText || item.task.description)}</div>
          {item.task.status === 'running' && !item.waitingApproval && <div className="mt-2 h-px overflow-hidden bg-border/35"><div className="h-full w-1/2 animate-pulse bg-accent/70" /></div>}
        </div>
        {item.task.threadId && <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-text-muted/70" />}
      </button>)}
    </div>
  </section>
}
