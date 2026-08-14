import { memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, CheckCircle2, ChevronRight, Circle, Clock3, ExternalLink, GitBranch, ListTree, MessageSquareText, ShieldAlert, X } from 'lucide-react'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { getMessageText } from '@/renderer/agent/types'
import type { PlanTask } from '@/renderer/agent/plan/types'
import { Agent } from '@/renderer/agent/core/Agent'
import { useStore } from '@/renderer/store'

const copy = (language: string, zh: string, en: string) => language === 'zh' ? zh : en

function taskVisual(task: PlanTask, waiting: boolean, language: string) {
  if (waiting) return { label: copy(language, '等待批准', 'Approval'), icon: ShieldAlert, tone: 'text-amber-400', dot: 'bg-amber-400' }
  if (task.status === 'running') return { label: copy(language, '执行中', 'Running'), icon: Circle, tone: 'text-accent', dot: 'bg-accent' }
  if (task.status === 'completed') return { label: copy(language, '已完成', 'Completed'), icon: CheckCircle2, tone: 'text-text-muted', dot: 'bg-emerald-400' }
  if (task.status === 'failed') return { label: copy(language, '失败', 'Failed'), icon: AlertTriangle, tone: 'text-red-400', dot: 'bg-red-400' }
  if (task.status === 'skipped' || task.status === 'cancelled') return { label: copy(language, '已跳过', 'Skipped'), icon: X, tone: 'text-text-muted', dot: 'bg-text-muted' }
  return { label: copy(language, '等待调度', 'Queued'), icon: Clock3, tone: 'text-text-muted', dot: 'bg-text-muted/50' }
}

interface PlanConversationWorkspaceProps {
  conversation: ReactNode
}

export const PlanConversationWorkspace = memo(function PlanConversationWorkspace({ conversation }: PlanConversationWorkspaceProps) {
  const language = useStore(state => state.language)
  const activePlanId = useAgentStore(state => state.activePlanId)
  const plan = useAgentStore(state => state.plans.find(item => item.id === state.activePlanId))
  const threads = useAgentStore(state => state.threads)
  const switchThread = useAgentStore(state => state.switchThread)
  const [view, setView] = useState<'overview' | 'conversation'>(plan ? 'overview' : 'conversation')

  useEffect(() => {
    setView(activePlanId ? 'overview' : 'conversation')
  }, [activePlanId])

  const runtimes = useMemo(() => (plan?.tasks || []).map(task => {
    const thread = task.threadId ? threads[task.threadId] : undefined
    const waiting = thread?.streamState?.phase === 'tool_pending'
    const currentTool = thread?.streamState?.currentToolCall
    const latestAssistant = thread ? [...thread.messages].reverse().find(message => message.role === 'assistant') : undefined
    return {
      task,
      thread,
      waiting,
      currentTool,
      latestText: latestAssistant?.role === 'assistant' ? getMessageText(latestAssistant.content).trim() : '',
    }
  }), [plan?.tasks, threads])

  const active = runtimes.filter(item => item.task.status === 'running' || item.waiting)
  const queued = runtimes.filter(item => item.task.status === 'pending')
  const finished = runtimes.filter(item => ['completed', 'failed', 'skipped', 'cancelled'].includes(item.task.status))
  const completedCount = finished.filter(item => item.task.status === 'completed').length
  const percent = runtimes.length ? Math.round((completedCount / runtimes.length) * 100) : 0

  const TaskRow = ({ item, showResult = false }: { item: typeof runtimes[number], showResult?: boolean }) => {
    const visual = taskVisual(item.task, item.waiting, language)
    const Icon = visual.icon
    const detail = item.waiting
      ? copy(language, `等待批准 ${item.currentTool?.name || 'tool'}`, `Waiting to approve ${item.currentTool?.name || 'tool'}`)
      : item.currentTool
        ? `${copy(language, '正在执行', 'Running')} ${item.currentTool.name}`
        : item.task.error || item.task.output || item.latestText || item.task.description

    return <div className={`rounded-lg border px-3 py-2.5 ${item.waiting ? 'border-amber-400/25 bg-amber-400/[0.06]' : item.task.status === 'running' ? 'border-accent/20 bg-accent/[0.04]' : 'border-border/50 bg-surface/[0.16]'}`}>
      <div className="flex items-start gap-2.5">
        <div className="relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
          <Icon className={`h-3.5 w-3.5 ${visual.tone} ${item.task.status === 'running' && !item.waiting ? 'animate-pulse' : ''}`} />
          <span className={`absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full ${visual.dot}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">{item.task.title}</span>
            <span className={`shrink-0 text-[9px] font-medium ${visual.tone}`}>{visual.label}</span>
          </div>
          <p className={`mt-1 ${showResult ? 'line-clamp-3' : 'truncate'} text-[10px] leading-4 ${item.task.error ? 'text-red-300' : 'text-text-muted'}`}>{detail}</p>
          {(item.waiting || item.task.threadId) && <div className="mt-2 flex items-center gap-2">
            {item.waiting && <>
              <button onClick={() => Agent.reject(item.task.requestId || item.thread?.streamState?.requestId)} className="rounded px-2 py-1 text-[10px] text-text-muted hover:bg-red-500/10 hover:text-red-400">{copy(language, '拒绝', 'Reject')}</button>
              <button onClick={() => Agent.approve(item.task.requestId || item.thread?.streamState?.requestId)} className="rounded bg-accent px-2 py-1 text-[10px] font-medium text-white hover:bg-accent-hover"><Check className="mr-1 inline h-3 w-3" />{copy(language, '批准', 'Approve')}</button>
            </>}
            {item.task.threadId && <button onClick={() => switchThread(item.task.threadId!)} className="ml-auto inline-flex items-center gap-1 text-[10px] text-text-muted hover:text-accent"><ExternalLink className="h-3 w-3" />{copy(language, '日志', 'Log')}</button>}
          </div>}
        </div>
      </div>
    </div>
  }

  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/50 px-3">
      <button onClick={() => setView('overview')} className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium ${view === 'overview' ? 'bg-accent/10 text-accent' : 'text-text-muted hover:bg-surface-hover hover:text-text-primary'}`}><ListTree className="h-3.5 w-3.5" />{copy(language, '执行概览', 'Overview')}</button>
      <button onClick={() => setView('conversation')} className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium ${view === 'conversation' ? 'bg-accent/10 text-accent' : 'text-text-muted hover:bg-surface-hover hover:text-text-primary'}`}><MessageSquareText className="h-3.5 w-3.5" />{copy(language, '规划对话', 'Planning chat')}</button>
      {active.length > 1 && <span className="ml-auto inline-flex items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 text-[9px] font-medium text-accent"><GitBranch className="h-3 w-3" />{active.length} {copy(language, '并行', 'parallel')}</span>}
    </div>

    {view === 'conversation' ? <div className="min-h-0 flex-1">{conversation}</div> : <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 custom-scrollbar">
      {!plan ? <div className="flex h-full flex-col items-center justify-center text-center">
        <MessageSquareText className="mb-3 h-5 w-5 text-text-muted" />
        <div className="text-xs font-medium text-text-primary">{copy(language, '先完成需求澄清', 'Clarify the request first')}</div>
        <p className="mt-1 max-w-[260px] text-[10px] leading-4 text-text-muted">{copy(language, '计划生成后，这里会自动切换为多任务执行概览。', 'Once a plan is created, this area becomes the multi-task execution overview.')}</p>
        <button onClick={() => setView('conversation')} className="mt-3 text-[11px] font-medium text-accent hover:underline">{copy(language, '进入规划对话', 'Open planning chat')}<ChevronRight className="ml-0.5 inline h-3 w-3" /></button>
      </div> : <div className="space-y-4">
        <section>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-text-primary">{plan.name}</div>
              <div className="mt-1 text-[10px] text-text-muted">{completedCount}/{runtimes.length} {copy(language, '完成', 'complete')} · {plan.executionMode === 'parallel' ? copy(language, '并行调度', 'Parallel scheduling') : copy(language, '顺序调度', 'Sequential scheduling')}</div>
            </div>
            <span className="text-[10px] tabular-nums text-text-muted">{percent}%</span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-text-primary/[0.06]"><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }} /></div>
        </section>

        {active.length > 0 && <section>
          <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted"><span>{copy(language, '正在进行', 'In progress')}</span><span>{active.length}</span></div>
          <div className="space-y-2">{active.map(item => <TaskRow key={item.task.id} item={item} />)}</div>
        </section>}

        {queued.length > 0 && <section>
          <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted"><span>{copy(language, '等待队列', 'Queue')}</span><span>{queued.length}</span></div>
          <div className="space-y-1.5">{queued.map(item => <TaskRow key={item.task.id} item={item} />)}</div>
        </section>}

        {finished.length > 0 && <section>
          <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted"><span>{copy(language, '结果', 'Results')}</span><span>{finished.length}</span></div>
          <div className="space-y-1.5">{finished.map(item => <TaskRow key={item.task.id} item={item} showResult />)}</div>
        </section>}
      </div>}
    </div>}
  </div>
})

export default PlanConversationWorkspace
