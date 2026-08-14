import { memo, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ExternalLink, GitBranch, ShieldAlert, X } from 'lucide-react'
import type { ToolCall } from '@/renderer/agent/types'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { Agent } from '@/renderer/agent/core/Agent'
import { useStore } from '@/renderer/store'

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
const asString = (value: unknown): string => typeof value === 'string' ? value : ''
const asNumber = (value: unknown): number | undefined => typeof value === 'number' ? value : undefined

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function SubAgentTaskCard({ toolCall }: { toolCall: ToolCall }) {
  const language = useStore(state => state.language)
  const meta = asRecord(toolCall.arguments._meta)
  const threadId = asString(meta.subAgentThreadId)
  const startedAt = asNumber(meta.subAgentStartedAt)
  const childThread = useAgentStore(state => threadId ? state.threads[threadId] : undefined)
  const switchThread = useAgentStore(state => state.switchThread)
  const [expanded, setExpanded] = useState(toolCall.status === 'running' || toolCall.status === 'pending')
  const [now, setNow] = useState(Date.now())

  const isRunning = toolCall.status === 'running' || toolCall.status === 'pending'
  const isSuccess = toolCall.status === 'success'
  const isError = toolCall.status === 'error'
  const waitingApproval = childThread?.streamState?.phase === 'tool_pending'
  const currentTool = childThread?.streamState?.currentToolCall

  useEffect(() => {
    if (!isRunning) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isRunning])

  useEffect(() => {
    if (isSuccess || isError) setExpanded(false)
  }, [isError, isSuccess])

  const toolStats = useMemo(() => {
    let completed = 0
    let active = 0
    for (const message of childThread?.messages || []) {
      if (message.role !== 'assistant') continue
      for (const call of message.toolCalls || []) {
        if (call.status === 'success') completed++
        if (call.status === 'running' || call.status === 'awaiting' || call.status === 'pending') active++
      }
    }
    return { completed, active }
  }, [childThread?.messages])

  const status = (() => {
    if (isSuccess) return { label: language === 'zh' ? '已完成' : 'Completed', tone: 'text-text-muted' }
    if (isError) return { label: language === 'zh' ? '执行失败' : 'Failed', tone: 'text-red-400' }
    if (waitingApproval) return { label: language === 'zh' ? '等待批准' : 'Waiting for approval', tone: 'text-amber-400' }
    if (!threadId) return { label: language === 'zh' ? '正在启动' : 'Starting', tone: 'text-accent' }
    if (currentTool) return { label: `${language === 'zh' ? '正在执行' : 'Running'} ${currentTool.name}`, tone: 'text-accent' }
    if (childThread?.streamState?.phase === 'streaming') return { label: language === 'zh' ? '正在分析' : 'Analyzing', tone: 'text-accent' }
    return { label: language === 'zh' ? '运行中' : 'Running', tone: 'text-accent' }
  })()

  const description = asString(toolCall.arguments.description) || (language === 'zh' ? '子代理任务' : 'Sub-agent task')
  const elapsed = startedAt ? now - startedAt : asNumber(meta.subAgentDurationMs) || 0
  const rowStyle = waitingApproval
    ? 'border border-yellow-500/20 bg-yellow-500/5 shadow-sm shadow-yellow-500/5'
    : isError
      ? 'bg-red-500/5'
      : isRunning
        ? 'bg-accent/5'
        : 'hover:bg-text-primary/[0.02]'

  return <div className={`group relative my-0.5 overflow-hidden rounded-lg transition-colors ${rowStyle}`}>
    {isRunning && !waitingApproval && <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg"><div className="tool-card-sweep absolute inset-0 h-full w-[200%] bg-gradient-to-r from-transparent via-accent/10 to-transparent" /></div>}

    <button type="button" onClick={() => setExpanded(value => !value)} className="relative z-10 flex min-h-[32px] w-full items-center gap-2 py-1.5 text-left select-none">
      <ChevronDown className={`h-3.5 w-3.5 shrink-0 -rotate-90 text-text-muted/40 transition-transform group-hover:text-text-muted ${expanded ? 'rotate-0' : ''}`} />
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {isRunning && !waitingApproval ? <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-accent/30 bg-accent/20"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /></span>
          : waitingApproval ? <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
            : isSuccess ? <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-green-500/10"><Check className="h-2.5 w-2.5 text-green-500" /></span>
              : isError ? <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500/10"><X className="h-2.5 w-2.5 text-red-500" /></span>
                : <span className="h-3.5 w-3.5 rounded-full border border-text-muted/30" />}
      </span>
      <GitBranch className="h-3.5 w-3.5 shrink-0 text-text-muted/60" />
      <span className={`min-w-0 flex-1 truncate text-[12px] ${isRunning ? 'text-text-primary tool-text-shimmer' : 'text-text-secondary group-hover:text-text-primary'}`}>{description}</span>
      <span className={`shrink-0 text-[10px] ${status.tone}`}>{status.label}</span>
      {toolStats.completed > 0 && <span className="shrink-0 text-[10px] text-text-muted/70">{toolStats.completed}</span>}
      {elapsed > 0 && <span className="shrink-0 pr-2 text-[10px] tabular-nums text-text-muted/70">{formatDuration(elapsed)}</span>}
    </button>

    {expanded && <div className="relative space-y-2 pb-3 pl-[26px] pr-3 pt-0">
      <div className="absolute bottom-4 left-[13.5px] top-0 w-[1.5px] rounded-full bg-border/40" />
      <div className="relative z-10 space-y-2 pt-1">
        <div className="text-[11px] leading-5 text-text-muted">{asString(toolCall.arguments.prompt)}</div>
        {currentTool && <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
          <span>{language === 'zh' ? '当前工具' : 'Current tool'}</span>
          <code className="rounded bg-text-primary/[0.04] px-1.5 py-0.5 font-mono text-text-secondary">{currentTool.name}</code>
        </div>}
      {waitingApproval && <div className="flex items-center gap-2">
        <button type="button" onClick={() => Agent.reject(childThread?.streamState?.requestId)} className="rounded-md px-3 py-1.5 text-xs font-medium text-text-muted transition-all hover:bg-red-500/10 hover:text-red-400">{language === 'zh' ? '拒绝' : 'Reject'}</button>
        <button type="button" onClick={() => Agent.approve(childThread?.streamState?.requestId)} className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-accent-hover">{language === 'zh' ? '批准' : 'Approve'}</button>
      </div>}
      {toolCall.result && !isRunning && <div className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-text-primary/[0.025] px-3 py-2 text-[11px] leading-5 text-text-secondary custom-scrollbar">{toolCall.result}</div>}
      {threadId && <button type="button" onClick={() => switchThread(threadId)} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-accent hover:underline"><ExternalLink className="h-3.5 w-3.5" />{language === 'zh' ? '查看实时线程' : 'Open live thread'}</button>}
      </div>
    </div>}
  </div>
}

export default memo(SubAgentTaskCard)
