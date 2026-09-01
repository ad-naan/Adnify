import { memo, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Circle, ExternalLink, GitBranch, LoaderCircle, ShieldAlert, Wrench, X } from 'lucide-react'
import type { ToolCall } from '@/renderer/agent/types'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { Agent } from '@/renderer/agent/core/Agent'
import { buildSubAgentExecutionSteps, type SubAgentStepState } from '@/renderer/agent/presentation/subAgentExecution'
import { useStore } from '@/renderer/store'
import { t } from '@shared/i18n'

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
const asString = (value: unknown): string => typeof value === 'string' ? value : ''
const asNumber = (value: unknown): number | undefined => typeof value === 'number' ? value : undefined

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function StepIcon({ state }: { state: SubAgentStepState }) {
  if (state === 'complete') return <Check className="h-2.5 w-2.5 text-green-500" />
  if (state === 'error') return <X className="h-2.5 w-2.5 text-red-500" />
  if (state === 'waiting') return <ShieldAlert className="h-3 w-3 text-amber-400" />
  if (state === 'active') return <LoaderCircle className="h-3 w-3 animate-spin text-accent motion-reduce:animate-none" />
  return <Circle className="h-2.5 w-2.5 text-text-muted/30" />
}

function SubAgentTaskCard({ toolCall }: { toolCall: ToolCall }) {
  const language = useStore(state => state.language)
  const meta = asRecord(toolCall.arguments._meta)
  const threadId = asString(meta.subAgentThreadId)
  const startedAt = asNumber(meta.subAgentStartedAt)
  const finishedDuration = asNumber(meta.subAgentDurationMs)
  const childThread = useAgentStore(state => threadId ? state.threads[threadId] : undefined)
  const switchThread = useAgentStore(state => state.switchThread)
  const [expanded, setExpanded] = useState(toolCall.status === 'running' || toolCall.status === 'pending')
  const [now, setNow] = useState(Date.now())

  const isRunning = toolCall.status === 'running' || toolCall.status === 'pending'
  const isSuccess = toolCall.status === 'success'
  const isError = toolCall.status === 'error' || toolCall.status === 'rejected'
  const waitingApproval = childThread?.streamState?.phase === 'tool_pending'
  const currentTool = childThread?.streamState?.currentToolCall

  useEffect(() => {
    if (!isRunning || !startedAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isRunning, startedAt])

  const completedTools = useMemo(() => {
    let count = 0
    for (const message of childThread?.messages || []) {
      if (message.role !== 'assistant') continue
      for (const call of message.toolCalls || []) {
        if (call.status === 'success') count++
      }
    }
    return count
  }, [childThread?.messages])

  const steps = useMemo(() => buildSubAgentExecutionSteps({
    language,
    hasThread: Boolean(threadId),
    isRunning,
    isSuccess,
    isError,
    waitingApproval,
    currentToolName: currentTool?.name,
    completedToolCount: completedTools,
  }), [completedTools, currentTool?.name, isError, isRunning, isSuccess, language, threadId, waitingApproval])

  const description = asString(toolCall.arguments.description) || (t('subAgentTaskCard.subAgentTask', language))
  const elapsed = isRunning && startedAt ? now - startedAt : finishedDuration || 0
  const cardStyle = waitingApproval
    ? 'border border-yellow-500/20 bg-yellow-500/5 shadow-sm shadow-yellow-500/5'
    : isError
      ? 'bg-red-500/5'
      : isRunning
        ? 'bg-accent/5'
        : 'hover:bg-text-primary/[0.02]'

  return <div className={`group relative my-0.5 overflow-hidden rounded-lg transition-colors motion-reduce:transition-none ${cardStyle}`}>
    {isRunning && !waitingApproval && <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg"><div className="tool-card-sweep absolute inset-0 h-full w-[200%] bg-gradient-to-r from-transparent via-accent/10 to-transparent motion-reduce:hidden" /></div>}

    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="relative z-10 flex min-h-[32px] w-full items-center gap-2 py-1.5 text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40">
      <ChevronDown className={`h-3.5 w-3.5 shrink-0 -rotate-90 text-text-muted/40 transition-transform group-hover:text-text-muted motion-reduce:transition-none ${expanded ? 'rotate-0' : ''}`} />
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {isRunning && !waitingApproval ? <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-accent/30 bg-accent/20"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" /></span>
          : waitingApproval ? <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
            : isSuccess ? <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-green-500/10"><Check className="h-2.5 w-2.5 text-green-500" /></span>
              : isError ? <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500/10"><X className="h-2.5 w-2.5 text-red-500" /></span>
                : <span className="h-3.5 w-3.5 rounded-full border border-text-muted/30" />}
      </span>
      <GitBranch className="h-3.5 w-3.5 shrink-0 text-text-muted/60" />
      <span className={`min-w-0 flex-1 truncate text-[12px] ${isRunning ? 'text-text-primary tool-text-shimmer' : 'text-text-secondary group-hover:text-text-primary'}`}>
        <span className="text-text-muted">SubAgent</span><span className="px-1.5 text-text-muted/35">·</span>{description}
      </span>
      {waitingApproval && <span className="shrink-0 text-[10px] text-amber-400">{t('subAgentTaskCard.approvalNeeded', language)}</span>}
      {completedTools > 0 && <span className="shrink-0 text-[10px] tabular-nums text-text-muted/60">{completedTools}</span>}
      {elapsed > 0 && <span className="shrink-0 pr-2 text-[10px] tabular-nums text-text-muted/60">{formatDuration(elapsed)}</span>}
    </button>

    {expanded && <div className="relative pb-3 pl-[26px] pr-3 pt-0">
      <div className="absolute bottom-4 left-[13.5px] top-0 w-[1.5px] rounded-full bg-border/40" />
      <ol className="relative z-10 space-y-1 pt-1">
        {steps.map(step => <li key={step.id} className="flex min-h-7 items-start gap-2">
          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center"><StepIcon state={step.state} /></span>
          <span className="min-w-0 flex-1 pt-px">
            <span className="text-[11px] font-medium text-text-secondary">{step.label}</span>
            <span className="ml-2 text-[10px] text-text-muted">{step.detail}</span>
            {step.id === 'brief' && asString(toolCall.arguments.prompt) && <span className="mt-0.5 block truncate text-[10px] text-text-muted/70">{asString(toolCall.arguments.prompt)}</span>}
            {step.id === 'work' && currentTool && <span className="mt-0.5 flex items-center gap-1 text-[10px] text-text-muted"><Wrench className="h-3 w-3 text-accent/70" /><code className="font-mono">{currentTool.name}</code></span>}
          </span>
        </li>)}
      </ol>

      {waitingApproval && <div className="mt-2 flex items-center gap-2 pl-6">
        <button type="button" onClick={() => Agent.reject(childThread?.streamState?.requestId)} className="rounded-md px-2.5 py-1.5 text-[11px] font-medium text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400">{t('toolReject', language)}</button>
        <button type="button" onClick={() => Agent.approve(childThread?.streamState?.requestId)} className="rounded-md bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-accent-hover">{t('toolApprove', language)}</button>
      </div>}

      {(toolCall.result || toolCall.error) && !isRunning && <div className={`ml-6 mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-md px-2.5 py-2 text-[10px] leading-5 custom-scrollbar ${isError ? 'bg-red-500/10 text-red-300' : 'bg-text-primary/[0.025] text-text-secondary'}`}>{toolCall.result || toolCall.error}</div>}
      {threadId && <button type="button" onClick={() => switchThread(threadId)} className="ml-6 mt-2 inline-flex items-center gap-1.5 text-[10px] font-medium text-accent hover:underline"><ExternalLink className="h-3 w-3" />{t('subAgentTaskCard.openSubTask', language)}</button>}
    </div>}
  </div>
}

export default memo(SubAgentTaskCard)
