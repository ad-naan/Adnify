import { Check, CheckCircle2, Clock3, CornerDownRight, ExternalLink, LoaderCircle, ShieldAlert, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { PlanTaskRuntimeItem } from '@/renderer/agent/plan/planWorkbenchProjection'
import { getPlanProviderDisplayName } from '@/renderer/agent/plan/planProviderCatalog'
import { t, type Language } from '@shared/i18n'
import { PlanExecutionSummary } from '../PlanExecutionSummary'

function useNow(running: boolean) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])
  return now
}

function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function taskDuration(item: PlanTaskRuntimeItem, now: number) {
  if (!item.task.startedAt) return '—'
  return formatDuration((item.task.completedAt || now) - item.task.startedAt)
}

function subAgentDuration(startedAt: number | undefined, durationMs: number | undefined, now: number) {
  if (durationMs !== undefined) return formatDuration(durationMs)
  return startedAt ? formatDuration(now - startedAt) : '—'
}

function TaskStateIcon({ item }: { item: PlanTaskRuntimeItem }) {
  if (item.waitingApproval) return <ShieldAlert className="h-3.5 w-3.5 plan-approval-ink" />
  if (item.task.status === 'running') return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-accent" />
  if (item.task.status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
  if (item.task.status === 'failed') return <X className="h-3.5 w-3.5 text-red-400" />
  return <Clock3 className="h-3.5 w-3.5 text-text-muted/45" />
}

interface Props {
  items: PlanTaskRuntimeItem[]
  completed: number
  language: Language
  onOpenThread: (threadId: string) => void
  onApprove: (requestId?: string) => void
  onReject: (requestId?: string) => void
}

export function PlanWorkbenchRuntime({ items, completed, language, onOpenThread, onApprove, onReject }: Props) {
  const hasRunning = items.some(item => item.task.status === 'running')
  const now = useNow(hasRunning)
  if (!items.length) return null

  return <section className="plan-runtime">
    <PlanExecutionSummary total={items.length} completed={completed} running={items.filter(item => item.task.status === 'running').length} approvals={items.filter(item => item.waitingApproval).length} failed={items.filter(item => item.task.status === 'failed').length} language={language} />

    <div className="mb-3 flex items-center justify-between px-0.5 text-[12px] text-text-muted">
      <span>{t('common.taskOrchestration', language)}</span>
      <span className="tabular-nums">{completed}/{items.length}</span>
    </div>
    <div className="space-y-2.5">
      {items.map(item => {
        const activity = item.latestActivity
        const currentAction = item.waitingApproval
          ? (t('planWorkbenchRuntime.waitingForApproval', language))
          : item.currentToolName || activity?.title || item.latestText || item.task.description
        return <article key={item.task.id} data-status={item.waitingApproval ? 'approval' : item.task.status} className="plan-runtime-card relative grid grid-cols-[18px_minmax(0,1fr)_auto] gap-2.5 rounded-xl border p-3.5">
          <span className="mt-0.5 flex h-5 w-4 self-start items-center justify-center"><TaskStateIcon item={item} /></span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold leading-5 text-text-primary break-words">{item.task.title}</span>
              {item.task.status === 'running' && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.waitingApproval ? 'bg-amber-400' : 'animate-pulse bg-emerald-400'}`} />}
            </div>
            <div className={`mt-2 border-l-2 pl-2 text-[12px] leading-4 ${item.task.status === 'running' && !item.waitingApproval ? 'border-emerald-500 text-text-secondary' : 'border-border text-text-muted'}`}>{currentAction}</div>
            <div className="mt-2 flex min-w-0 items-center gap-2 text-[12px] text-text-muted">
              <span className="truncate">{item.task.role}</span><span>·</span><span className="truncate">{getPlanProviderDisplayName(item.task.provider)} · {item.task.model}</span>
            </div>

            {item.waitingApproval && <div className="mt-2.5 overflow-hidden rounded-lg border border-amber-400/25 bg-amber-400/[0.045]">
              <div className="px-2.5 py-2">
                <div className="flex items-center gap-1.5 text-[12px] font-medium plan-approval-ink"><ShieldAlert className="h-3 w-3" />{t('planWorkbenchRuntime.approvalRequest', language)}</div>
                <div className="mt-1.5 truncate rounded bg-background/50 px-2 py-1.5 font-mono text-[12px] text-text-muted">{item.currentToolName}</div>
                {item.currentToolArguments && <pre className="mt-1.5 max-h-20 overflow-auto whitespace-pre-wrap break-all px-1 text-[12px] leading-4 text-text-muted">{JSON.stringify(item.currentToolArguments, null, 2)}</pre>}
              </div>
              <div className="flex justify-end gap-1.5 border-t border-amber-400/15 px-2 py-1.5">
                <button onClick={() => onReject(item.requestId)} className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-[12px] text-text-muted hover:bg-red-500/10 hover:text-red-400"><X className="h-2.5 w-2.5" />{t('toolReject', language)}</button>
                <button onClick={() => onApprove(item.requestId)} className="inline-flex min-h-8 items-center gap-1 rounded-md bg-accent px-2 text-[12px] font-medium text-white hover:bg-accent-hover"><Check className="h-2.5 w-2.5" />{t('common.approve', language)}</button>
              </div>
            </div>}

            {item.subAgents.length > 0 && <div className="mt-2.5 border-l border-border/55 pl-2.5">
              <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-text-muted"><CornerDownRight className="h-3 w-3" />{t('planWorkbenchRuntime.subAgents', language)} · {item.subAgents.length}</div>
              {item.subAgents.map(subAgent => <div key={subAgent.id} className="border-t border-border/30 py-2 first:border-t-0">
                <div className="flex items-start gap-2">
                  {subAgent.status === 'running' ? <LoaderCircle className="mt-0.5 h-3 w-3 shrink-0 animate-spin text-accent" /> : subAgent.status === 'waiting_approval' ? <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0 plan-approval-ink" /> : subAgent.status === 'completed' ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" /> : subAgent.status === 'failed' ? <X className="mt-0.5 h-3 w-3 shrink-0 text-red-400" /> : <Clock3 className="mt-0.5 h-3 w-3 shrink-0 text-text-muted/45" />}
                  <div className="min-w-0 flex-1"><div className="truncate text-[12px] font-medium text-text-secondary">{subAgent.description}</div><div className="mt-0.5 truncate text-[12px] text-text-muted">{subAgent.currentToolName || subAgent.currentAction || (t('planWorkbenchRuntime.waiting', language))}</div></div>
                  <time className="text-[12px] tabular-nums text-text-muted/60">{subAgentDuration(subAgent.startedAt, subAgent.durationMs, now)}</time>
                  {subAgent.threadId && <button onClick={() => onOpenThread(subAgent.threadId!)} aria-label={t('planWorkbenchRuntime.openSubAgentLog', language)} className="rounded p-0.5 text-text-muted/55 hover:text-text-secondary"><ExternalLink className="h-2.5 w-2.5" /></button>}
                </div>
                {subAgent.status === 'waiting_approval' && <div className="mt-2 rounded-md border border-amber-400/20 bg-amber-400/[0.04] p-2">
                  <div className="truncate font-mono text-[12px] text-text-muted">{subAgent.currentToolName}</div>
                  {subAgent.currentToolArguments && <pre className="mt-1 max-h-16 overflow-auto whitespace-pre-wrap break-all text-[12px] leading-4 text-text-muted">{JSON.stringify(subAgent.currentToolArguments, null, 2)}</pre>}
                  <div className="mt-1.5 flex justify-end gap-1"><button onClick={() => onReject(subAgent.requestId)} className="h-5 rounded px-1.5 text-[12px] text-text-muted hover:text-red-400">{t('toolReject', language)}</button><button onClick={() => onApprove(subAgent.requestId)} className="h-5 rounded bg-accent px-1.5 text-[12px] text-white">{t('toolApprove', language)}</button></div>
                </div>}
              </div>)}
            </div>}
          </div>
          <div className="flex flex-col items-end gap-2">
            <time className="text-[12px] tabular-nums text-text-muted/65">{taskDuration(item, now)}</time>
            {item.task.threadId && <button onClick={() => onOpenThread(item.task.threadId!)} aria-label={t('planWorkbenchRuntime.openTaskLog', language)} className="rounded p-1 text-text-muted/55 hover:bg-surface-hover hover:text-text-secondary"><ExternalLink className="h-3 w-3" /></button>}
          </div>
        </article>
      })}
    </div>
  </section>
}
