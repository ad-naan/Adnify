import { Check, ShieldAlert, X } from 'lucide-react'
import type { PlanTaskRuntimeItem } from '@/renderer/agent/plan/planWorkbenchProjection'

interface Props {
  items: PlanTaskRuntimeItem[]
  language: string
  onApprove: (requestId?: string) => void
  onReject: (requestId?: string) => void
}

export function PlanWorkbenchApproval({ items, language, onApprove, onReject }: Props) {
  if (!items.length) return null

  return <section className="mt-4 space-y-2">
    {items.map(item => <article key={item.task.id} className="overflow-hidden rounded-xl border border-amber-400/25 bg-amber-400/[0.045]">
      <div className="flex items-start gap-3 px-3.5 py-3">
        <span className="relative mt-0.5 shrink-0"><ShieldAlert className="h-4 w-4 text-amber-400" /><span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold leading-4 text-text-primary">{item.task.title}</div>
          <div className="mt-1 font-mono text-[10px] text-text-muted">{item.currentToolName}</div>
          {item.currentToolArguments && <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-md bg-background/45 px-2.5 py-2 text-[9px] leading-4 text-text-muted">{JSON.stringify(item.currentToolArguments, null, 2)}</pre>}
        </div>
      </div>
      <div className="flex justify-end gap-1.5 border-t border-amber-400/15 px-3 py-2">
        <button onClick={() => onReject(item.requestId)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-text-muted hover:bg-red-500/10 hover:text-red-400"><X className="h-3 w-3" />{language === 'zh' ? '拒绝' : 'Reject'}</button>
        <button onClick={() => onApprove(item.requestId)} className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[10px] font-medium text-white hover:bg-accent-hover"><Check className="h-3 w-3" />{language === 'zh' ? '批准' : 'Approve'}</button>
      </div>
    </article>)}
  </section>
}
