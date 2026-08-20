import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Check, CheckCircle2, Circle, ExternalLink, FileCode2, FileOutput, FileText,
  GitBranch, History, LoaderCircle, Pause, Play, Rows3, Settings2, ShieldAlert,
  Square, TerminalSquare, X, MessageSquareText,
} from 'lucide-react'
import { Button, Select } from '@/renderer/components/ui'
import { MarkdownPreview } from '@/renderer/components/editor/FilePreview'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { Agent } from '@/renderer/agent/core/Agent'
import { getMessageText } from '@/renderer/agent/types'
import type { AssistantMessage, ChatMessage } from '@/renderer/agent/types'
import { useStore } from '@/renderer/store'
import { toast } from '@/renderer/components/common/ToastProvider'
import { api } from '@/renderer/services/electronAPI'
import { getPromptTemplateSummary } from '@/renderer/agent/prompts/promptTemplates'
import type { ExecutionMode, PlanTask } from '@/renderer/agent/store/slices/planSlice'
import type { PlanWorkbenchStage } from '@/renderer/agent/plan/planWorkbenchProjection'
import { PlanStageTrace } from './PlanStageTrace'
import { PlanDependencyGraph } from './PlanDependencyGraph'
import { layoutPlanGraph } from '@/renderer/agent/plan/planGraphLayout'
import { beginPlanRevision } from '@/renderer/agent/plan/planRevisionService'
import { usePlanViewStore } from '@/renderer/agent/plan/planViewStore'
import { PlanModelSelector } from './PlanModelSelector'
import { PlanTaskInspector } from './PlanTaskInspector'
import { PlanStageContentView } from './PlanStageContentView'
import { legacyRequirementsToStageContent } from '@/renderer/agent/plan/planStageContent'
import { getPlanProviderDisplayName } from '@/renderer/agent/plan/planProviderCatalog'

interface TaskBoardProps {
  planId: string
  planOptions?: Array<{ value: string, label: string }>
  onPlanChange?: (planId: string) => void
}

const copy = (language: string, zh: string, en: string) => language === 'zh' ? zh : en

function deriveStage(status: string): PlanWorkbenchStage {
  if (status === 'completed') return 'validation'
  if (['executing', 'pausing', 'paused', 'stopping'].includes(status)) return 'execution'
  return 'plan'
}

function statusMeta(task: PlanTask, waitingApproval: boolean, language: string) {
  if (waitingApproval) return { label: copy(language, '等待批准', 'Needs approval'), tone: 'text-amber-400', bg: 'bg-amber-400/10', icon: ShieldAlert }
  switch (task.status) {
    case 'completed': return { label: copy(language, '已完成', 'Completed'), tone: 'text-emerald-400', bg: 'bg-emerald-400/10', icon: CheckCircle2 }
    case 'running': return { label: copy(language, '执行中', 'Running'), tone: 'text-accent', bg: 'bg-accent/10', icon: LoaderCircle }
    case 'failed': return { label: copy(language, '失败', 'Failed'), tone: 'text-red-400', bg: 'bg-red-400/10', icon: AlertTriangle }
    case 'skipped': return { label: copy(language, '已跳过', 'Skipped'), tone: 'text-text-muted', bg: 'bg-text-primary/5', icon: Circle }
    case 'cancelled': return { label: copy(language, '已取消', 'Cancelled'), tone: 'text-text-muted', bg: 'bg-text-primary/5', icon: X }
    default: return { label: copy(language, '待执行', 'Queued'), tone: 'text-text-muted', bg: 'bg-text-primary/5', icon: Circle }
  }
}

function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

interface RequirementSection {
  title: string
  items: string[]
}

function parseRequirementDocument(content: string, fallbackTitle: string, language: string) {
  const lines = content.split(/\r?\n/)
  let title = fallbackTitle
  const sections: RequirementSection[] = []
  let current: RequirementSection | null = null

  const ensureSection = () => {
    if (!current) {
      current = { title: language === 'zh' ? '已确认范围' : 'Confirmed scope', items: [] }
      sections.push(current)
    }
    return current
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line === '---') continue
    const heading = /^(#{1,4})\s+(.+)$/.exec(line)
    if (heading) {
      if (heading[1].length === 1 && title === fallbackTitle) {
        title = heading[2].trim()
      } else {
        current = { title: heading[2].trim(), items: [] }
        sections.push(current)
      }
      continue
    }
    const listItem = /^(?:[-*+]\s+|\d+[.)]\s+)(.+)$/.exec(line)
    ensureSection().items.push((listItem?.[1] || line).replace(/^\*\*(.+)\*\*:?$/, '$1').trim())
  }

  return {
    title,
    sections: sections.filter(section => section.items.length > 0),
  }
}

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

function taskDepth(task: PlanTask, tasks: PlanTask[], cache: Map<string, number>, visiting = new Set<string>()): number {
  if (cache.has(task.id)) return cache.get(task.id)!
  if (!task.dependencies.length || visiting.has(task.id)) return 0
  visiting.add(task.id)
  const parents = task.dependencies.map(id => tasks.find(item => item.id === id)).filter((item): item is PlanTask => Boolean(item))
  const depth = parents.length ? Math.min(3, 1 + Math.max(...parents.map(parent => taskDepth(parent, tasks, cache, visiting)))) : 0
  visiting.delete(task.id)
  cache.set(task.id, depth)
  return depth
}

const ModeToggle = memo(function ModeToggle({ mode, disabled, onChange, language }: {
  mode: ExecutionMode
  disabled: boolean
  onChange: (mode: ExecutionMode) => void
  language: string
}) {
  return <div className="inline-flex rounded-md border border-border/60 bg-background/55 p-0.5">
    {([
      ['sequential', Rows3, copy(language, '顺序', 'Serial')],
      ['parallel', GitBranch, copy(language, '并行', 'Parallel')],
    ] as const).map(([value, Icon, label]) => <button key={value} type="button" disabled={disabled} onClick={() => onChange(value)} className={`flex h-6 items-center gap-1.5 rounded px-2 text-[9px] font-medium disabled:opacity-50 ${mode === value ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}><Icon className="h-3 w-3" />{label}</button>)}
  </div>
})

/**
 * Per-thread scans cached by message-array identity.
 *
 * `runtimeByTask` depends on the whole `threads` record, which gets a new
 * identity on every streaming flush (~30×/s). Re-walking each task thread's full
 * history that often is the dominant cost of the board once a plan has run for a
 * while; only the streaming thread actually has new messages.
 */
const RECENT_TOOL_EVENT_LIMIT = 12

interface TaskToolEvent {
  id: string
  name: string
  detail: string
}

const latestAssistantCache = new WeakMap<readonly ChatMessage[], AssistantMessage | undefined>()
const toolEventsCache = new WeakMap<readonly ChatMessage[], TaskToolEvent[]>()

function findLastAssistant(messages: readonly ChatMessage[]): AssistantMessage | undefined {
  if (latestAssistantCache.has(messages)) return latestAssistantCache.get(messages)

  let found: AssistantMessage | undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'assistant') {
      found = message
      break
    }
  }
  latestAssistantCache.set(messages, found)
  return found
}

function collectRecentToolEvents(messages: readonly ChatMessage[]): TaskToolEvent[] {
  const cached = toolEventsCache.get(messages)
  if (cached) return cached

  // Walk backwards and stop once the tail is filled, instead of building an
  // event object for every tool call in the history and slicing the last 12.
  const reversed: TaskToolEvent[] = []
  outer: for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant') continue
    const toolCalls = message.toolCalls || []
    for (let callIndex = toolCalls.length - 1; callIndex >= 0; callIndex -= 1) {
      const toolCall = toolCalls[callIndex]
      reversed.push({
        id: toolCall.id,
        name: toolCall.name,
        detail: toolCall.result ? String(toolCall.result) : (toolCall.arguments ? JSON.stringify(toolCall.arguments) : ''),
      })
      if (reversed.length >= RECENT_TOOL_EVENT_LIMIT) break outer
    }
  }

  const events = reversed.reverse()
  toolEventsCache.set(messages, events)
  return events
}

export const TaskBoard = memo(function TaskBoard({ planId, planOptions = [], onPlanChange }: TaskBoardProps) {
  const language = useStore(state => state.language)
  const workspacePath = useStore(state => state.workspacePath)
  const plan = useAgentStore(state => state.plans.find(item => item.id === planId))
  const threads = useAgentStore(state => state.threads)
  const updatePlan = useAgentStore(state => state.updatePlan)
  const updateTask = useAgentStore(state => state.updateTask)
  const switchThread = useAgentStore(state => state.switchThread)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [requirementsContent, setRequirementsContent] = useState('')
  const [showRequirements, setShowRequirements] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const selectedViewStage = usePlanViewStore(state => state.selectedStageByPlanId[planId])
  const selectViewStage = usePlanViewStore(state => state.selectStage)

  const runtimeByTask = useMemo(() => new Map((plan?.tasks || []).map(task => {
    const thread = task.threadId ? threads[task.threadId] : undefined
    const waitingApproval = thread?.streamState?.phase === 'tool_pending'
    const latestAssistant = thread ? findLastAssistant(thread.messages) : undefined
    const events = thread ? collectRecentToolEvents(thread.messages) : []
    return [task.id, {
      thread,
      waitingApproval,
      tool: waitingApproval ? thread?.streamState?.currentToolCall : undefined,
      currentTool: thread?.streamState?.currentToolCall,
      statusText: thread?.streamState?.statusText,
      latestText: latestAssistant ? getMessageText(latestAssistant.content).trim() : '',
      events,
    }] as const
  })), [plan?.tasks, threads])

  const selectedTask = plan?.tasks.find(task => task.id === selectedTaskId) || plan?.tasks[0]
  const selectedRuntime = selectedTask ? runtimeByTask.get(selectedTask.id) : undefined
  const isLive = Boolean(plan && ['executing', 'pausing', 'stopping'].includes(plan.status))
  const isPaused = plan?.status === 'paused'
  const canStart = Boolean(plan && ['draft', 'approved', 'stopped', 'failed'].includes(plan.status) && plan.tasks.some(task => task.status === 'pending'))
  const actualStage = deriveStage(plan?.status || 'draft')
  const stage = selectedViewStage || actualStage
  const now = useNow(isLive)

  useEffect(() => {
    if (plan?.id) selectViewStage(plan.id, actualStage)
  }, [actualStage, plan?.id, selectViewStage])

  useEffect(() => {
    if (!plan?.tasks.length) return
    const approval = plan.tasks.find(task => runtimeByTask.get(task.id)?.waitingApproval)
    if (approval) setSelectedTaskId(approval.id)
    else if (!selectedTaskId || !plan.tasks.some(task => task.id === selectedTaskId)) setSelectedTaskId(plan.tasks[0].id)
  }, [plan?.tasks, runtimeByTask, selectedTaskId])

  useEffect(() => {
    if (!plan?.requirementsDoc || !workspacePath) return
    api.file.read(`${workspacePath}/.adnify/plan/${plan.requirementsDoc}`).then(content => setRequirementsContent(content || '')).catch(() => setRequirementsContent(''))
  }, [plan?.requirementsDoc, workspacePath])

  const stats = useMemo(() => {
    const tasks = plan?.tasks || []
    const completed = tasks.filter(task => task.status === 'completed').length
    const failed = tasks.filter(task => task.status === 'failed').length
    const running = tasks.filter(task => task.status === 'running').length
    const approvals = tasks.filter(task => runtimeByTask.get(task.id)?.waitingApproval).length
    const files = Array.from(new Set(tasks.flatMap(task => task.producesFiles || [])))
    const starts = tasks.map(task => task.startedAt).filter((value): value is number => typeof value === 'number')
    const ends = tasks.map(task => task.completedAt).filter((value): value is number => typeof value === 'number')
    const duration = starts.length ? ((ends.length === tasks.length ? Math.max(...ends) : now) - Math.min(...starts)) : 0
    return { total: tasks.length, completed, failed, running, approvals, files, duration, percent: tasks.length ? Math.round((completed / tasks.length) * 100) : 0 }
  }, [now, plan?.tasks, runtimeByTask])

  const graphStats = useMemo(() => {
    const tasks = plan?.tasks || []
    const layout = layoutPlanGraph(tasks)
    const rankCounts = new Map<number, number>()
    for (const node of layout.nodes) rankCounts.set(node.rank, (rankCounts.get(node.rank) || 0) + 1)
    const roles = new Set(tasks.map(task => task.role).filter(Boolean))
    const models = new Set(tasks.map(task => `${task.provider}:${task.model}`).filter(Boolean))
    const estimatedTokens = tasks.reduce((total, task) => total + (task.estimatedTokens || 0), 0)
    return {
      maxParallelism: Math.max(0, ...rankCounts.values()),
      roles: roles.size,
      models: models.size,
      estimatedTokens,
      hasCycle: layout.hasCycle,
      missingDependencies: layout.missingDependencies.length,
    }
  }, [plan?.tasks])

  const requirementStageContent = useMemo(() => plan?.stageContent?.requirements
    || legacyRequirementsToStageContent(requirementsContent, plan?.name || '', language), [language, plan?.name, plan?.stageContent?.requirements, requirementsContent])
  const requirementDocument = useMemo(
    () => parseRequirementDocument(requirementsContent, plan?.name || '', language),
    [language, plan?.name, requirementsContent],
  )

  const waitingApprovalTaskIds = useMemo(() => new Set(
    (plan?.tasks || []).filter(task => runtimeByTask.get(task.id)?.waitingApproval).map(task => task.id)
  ), [plan?.tasks, runtimeByTask])

  const depths = useMemo(() => {
    const cache = new Map<string, number>()
    for (const task of plan?.tasks || []) taskDepth(task, plan?.tasks || [], cache)
    return cache
  }, [plan?.tasks])

  const start = useCallback(async () => {
    if (!plan) return
    const { startPlanExecution } = await import('@/renderer/agent/plan/planExecutor')
    const result = await startPlanExecution(plan.id)
    if (!result.success) toast.error(copy(language, '启动执行失败', 'Failed to start'), result.message)
  }, [language, plan])
  const pause = useCallback(async () => (await import('@/renderer/agent/plan/planExecutor')).pausePlanExecution(planId), [planId])
  const stop = useCallback(async () => (await import('@/renderer/agent/plan/planExecutor')).stopPlanExecution(planId), [planId])
  const resume = useCallback(async () => (await import('@/renderer/agent/plan/planExecutor')).resumePlanExecution(planId), [planId])
  const requestChanges = useCallback(() => {
    const result = beginPlanRevision(planId, 'validation', language)
    if (result.success) toast.info(result.message)
    else toast.error(copy(language, '无法继续调整', 'Unable to revise'), result.message)
  }, [language, planId])

  if (!plan) return <div className="flex h-full items-center justify-center text-sm text-text-muted">{copy(language, '计划不存在', 'Plan not found')}</div>

  const promptOptions = getPromptTemplateSummary().map(item => ({ value: item.id, label: item.nameZh || item.name }))

  return <div className="plan-readable relative flex h-full min-h-0 flex-col bg-background">
    <header className="shrink-0 border-b border-border/50 px-5 pb-3.5 pt-3">
      <div className="flex h-8 items-center gap-3 border-b border-border/35 pb-3">
        <History className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        <span className="shrink-0 text-[10px] text-text-muted">{copy(language, '计划历史', 'Plan history')}</span>
        {planOptions.length > 0 && onPlanChange
          ? <Select className="w-[290px] border-0 bg-transparent font-semibold" options={planOptions} value={plan.id} onChange={onPlanChange} />
          : <h1 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-text-primary">{plan.name}</h1>}
      </div>
      <div className="mt-3 flex items-center justify-between gap-5">
        <div className="w-full max-w-[520px]"><PlanStageTrace stage={actualStage} selectedStage={stage} language={language} onStageChange={nextStage => selectViewStage(plan.id, nextStage)} /></div>
        <div className="flex shrink-0 items-center gap-2">
          <ModeToggle language={language} mode={plan.executionMode} disabled={isLive || isPaused} onChange={mode => updatePlan(plan.id, { executionMode: mode })} />
          <Button variant="ghost" size="sm" onClick={() => setShowRequirements(true)} leftIcon={<FileText className="h-3.5 w-3.5" />}>{copy(language, '需求', 'Brief')}</Button>
          {isLive ? <><Button variant="secondary" size="sm" onClick={pause} disabled={plan.status !== 'executing'} leftIcon={<Pause className="h-3.5 w-3.5" />}>{copy(language, '暂停计划', 'Pause')}</Button><Button variant="danger" size="sm" onClick={stop} leftIcon={<Square className="h-3 w-3" />}>{copy(language, '停止', 'Stop')}</Button></> : isPaused ? <><Button size="sm" onClick={resume} leftIcon={<Play className="h-3.5 w-3.5" />}>{copy(language, '继续', 'Resume')}</Button><Button variant="danger" size="sm" onClick={stop} leftIcon={<Square className="h-3 w-3" />}>{copy(language, '停止', 'Stop')}</Button></> : canStart ? <Button size="sm" onClick={start} leftIcon={<Play className="h-3.5 w-3.5" />}>{copy(language, '批准并执行', 'Approve and run')}</Button> : null}
        </div>
      </div>
      {(isLive || isPaused || actualStage === 'validation') && <div className="mt-3 h-0.5 overflow-hidden rounded-full bg-text-primary/[0.05]"><div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${stats.percent}%` }} /></div>}
    </header>

    {stage === 'requirements' ? <main className="min-h-0 flex-1 overflow-y-auto bg-background custom-scrollbar">
      <div className="mx-auto min-h-full max-w-5xl px-6 py-5">
        <div className="border-b border-border/45 pb-4">
          <h2 className="text-[16px] font-semibold text-text-primary">{copy(language, '需求澄清简报', 'Requirement brief')}</h2>
          <p className="mt-1.5 text-[10px] leading-5 text-text-muted">{copy(language, '以下信息来自已确认的真实需求文档，可随时返回审阅；调整会产生新的计划修订。', 'This review is generated from the confirmed source brief. Revisions create an updated plan version.')}</p>
        </div>
        <div className="mt-5"><PlanStageContentView content={requirementStageContent} hideHeader /></div>
        <section className="hidden mt-5 overflow-hidden rounded-xl border border-border/50 bg-surface/[0.06]">
          <div className="flex items-center gap-3 border-b border-border/40 px-4 py-3.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/[0.07] text-accent"><FileText className="h-4 w-4" /></span>
            <div className="min-w-0"><div className="text-[9px] font-medium text-text-muted">{copy(language, '本次目标', 'Objective')}</div><h3 className="mt-0.5 truncate text-[12px] font-semibold text-text-primary">{requirementDocument.title}</h3></div>
          </div>
          {requirementDocument.sections.length > 0 ? <div className="divide-y divide-border/40">
            {requirementDocument.sections.map((section, sectionIndex) => <div key={`${section.title}:${sectionIndex}`} className="grid grid-cols-[150px_minmax(0,1fr)] gap-5 px-4 py-3.5 max-md:grid-cols-1 max-md:gap-2">
              <div className="flex items-start gap-2 text-[10px] font-semibold text-text-secondary"><span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-500"><Check className="h-2.5 w-2.5" /></span><span>{section.title}</span></div>
              <div className="space-y-2">{section.items.map((item, itemIndex) => <div key={`${item}:${itemIndex}`} className="flex items-start gap-2 text-[10px] leading-5 text-text-secondary"><span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-text-muted/55" /><span>{item}</span></div>)}</div>
            </div>)}
          </div> : <div className="flex min-h-48 items-center justify-center text-[10px] text-text-muted">{copy(language, '需求文档正在整理', 'The brief is being prepared')}</div>}
        </section>
        <div className="mt-4 flex items-center justify-between rounded-lg border border-emerald-400/20 bg-emerald-400/[0.035] px-4 py-3">
          <div className="flex items-center gap-2 text-[10px] font-medium text-emerald-500"><CheckCircle2 className="h-4 w-4" />{copy(language, '需求已确认并生成结构化计划', 'Requirements confirmed and structured')}</div>
          <button type="button" onClick={requestChanges} className="text-[9px] font-medium text-text-muted hover:text-accent">{copy(language, '提出调整', 'Request revision')}</button>
        </div>
      </div>
    </main> : stage === 'validation' && actualStage !== 'validation' ? <main className="flex min-h-0 flex-1 items-center justify-center px-8 text-center">
      <div className="max-w-sm"><span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-text-primary/[0.04] text-text-muted"><CheckCircle2 className="h-5 w-5" /></span><h2 className="mt-3 text-[12px] font-semibold text-text-primary">{copy(language, '尚未进入验收阶段', 'Validation has not started')}</h2><p className="mt-1.5 text-[9px] leading-4 text-text-muted">{copy(language, '任务执行完成后，交付结果、失败项和变更文件会显示在这里。', 'Delivery results, failures, and changed files will appear here after execution.')}</p></div>
    </main> : stage === 'validation' ? <main className="min-h-0 flex-1 overflow-y-auto p-5 custom-scrollbar">
      <div className="mx-auto max-w-5xl">
        <section className="border-b border-border/45 pb-5">
          <div className="flex items-start justify-between gap-5"><div className="flex items-start gap-3"><CheckCircle2 className={`mt-0.5 h-5 w-5 shrink-0 ${stats.failed ? 'text-amber-400' : 'text-emerald-400'}`} /><div><h2 className="text-[15px] font-semibold text-text-primary">{plan.validation?.status === 'accepted' ? copy(language, '结果已经验收', 'Results accepted') : stats.failed ? copy(language, '执行结束，存在失败任务', 'Execution finished with failures') : copy(language, '计划已完成，等待验收', 'Plan complete and ready for validation')}</h2><p className="mt-1 text-[10px] leading-5 text-text-muted">{stats.completed}/{stats.total} {copy(language, '项任务完成', 'tasks completed')} · {stats.files.length} {copy(language, '个计划资源', 'planned resources')} · {formatDuration(stats.duration)}</p></div></div>
            {plan.validation?.status === 'accepted' ? <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-emerald-400/25 bg-emerald-400/[0.04] px-3 text-[9px] font-medium text-emerald-500"><CheckCircle2 className="h-3.5 w-3.5" />{copy(language, '已确认完成', 'Accepted')}</span> : <div className="flex shrink-0 gap-2"><Button variant="secondary" size="sm" onClick={requestChanges} leftIcon={<MessageSquareText className="h-3.5 w-3.5" />}>{copy(language, '继续调整', 'Request changes')}</Button><Button size="sm" disabled={stats.failed > 0} onClick={() => updatePlan(plan.id, { validation: { status: 'accepted', reviewedAt: Date.now() } })} leftIcon={<Check className="h-3.5 w-3.5" />}>{copy(language, '确认完成', 'Accept')}</Button></div>}
          </div>
        </section>
        <div className="mt-5 grid grid-cols-[minmax(0,1.25fr)_minmax(280px,.75fr)] gap-6 max-lg:grid-cols-1">
          <section><div className="mb-2 text-[10px] font-medium text-text-muted">{copy(language, '验收结果', 'Validation results')}</div><div className="divide-y divide-border/40 border-y border-border/40">{plan.tasks.map(task => <button key={task.id} onClick={() => setSelectedTaskId(task.id)} className="flex w-full items-start gap-3 py-3 text-left hover:bg-surface/[0.12]"><span className="mt-0.5">{task.status === 'completed' ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <AlertTriangle className="h-4 w-4 text-red-400" />}</span><span className="min-w-0 flex-1"><strong className="block truncate text-[11px] font-medium text-text-secondary">{task.title}</strong><span className="mt-1 block line-clamp-2 text-[9px] leading-4 text-text-muted">{task.error || task.output || task.description}</span></span><time className="text-[8px] tabular-nums text-text-muted">{task.startedAt ? formatDuration((task.completedAt || now) - task.startedAt) : '—'}</time></button>)}</div></section>
          <aside><div className="mb-2 text-[10px] font-medium text-text-muted">{copy(language, '交付资源', 'Delivered resources')}</div>{stats.files.length ? <div className="divide-y divide-border/35 border-y border-border/35">{stats.files.map(file => <div key={file} className="flex items-center gap-2 py-2.5 text-[9px] text-text-secondary"><FileCode2 className="h-3.5 w-3.5 text-text-muted" /><span className="min-w-0 flex-1 truncate">{file}</span></div>)}</div> : <p className="border-y border-border/35 py-3 text-[9px] leading-4 text-text-muted">{copy(language, '计划未声明产出文件，请根据各任务结果完成验收。', 'No output files were declared; review task results instead.')}</p>}</aside>
        </div>
      </div>
    </main> : stage === 'plan' ? <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <section className="mx-5 mt-4 shrink-0 rounded-xl border border-border/55 bg-surface/[0.08] px-4 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${graphStats.hasCycle || graphStats.missingDependencies ? 'bg-amber-400/10 text-amber-500' : 'bg-emerald-400/10 text-emerald-500'}`}>
              {graphStats.hasCycle || graphStats.missingDependencies ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            </span>
            <div className="min-w-0">
              <h2 className="text-[12px] font-semibold text-text-primary">{graphStats.hasCycle || graphStats.missingDependencies
                ? copy(language, '计划依赖需要调整', 'Plan dependencies need attention')
                : copy(language, '计划已就绪，等待审阅', 'Plan is ready for review')}</h2>
              <p className="mt-1 text-[9px] leading-4 text-text-muted">{copy(language, '任务节点与连线由真实依赖自动生成；审阅任务配置后即可批准执行。', 'Nodes and edges are generated from real dependencies. Review task setup before execution.')}</p>
            </div>
          </div>
          <div className="grid shrink-0 grid-cols-4 divide-x divide-border/50 text-center">
            <div className="min-w-[70px] px-3"><strong className="block text-[12px] font-semibold tabular-nums text-text-primary">{plan.tasks.length}</strong><span className="mt-0.5 block text-[8px] text-text-muted">{copy(language, '任务', 'Tasks')}</span></div>
            <div className="min-w-[70px] px-3"><strong className="block text-[12px] font-semibold tabular-nums text-text-primary">{graphStats.maxParallelism}</strong><span className="mt-0.5 block text-[8px] text-text-muted">{copy(language, '最大并行', 'Max parallel')}</span></div>
            <div className="min-w-[70px] px-3"><strong className="block text-[12px] font-semibold tabular-nums text-text-primary">{graphStats.roles}</strong><span className="mt-0.5 block text-[8px] text-text-muted">{copy(language, '角色', 'Roles')}</span></div>
            <div className="min-w-[84px] px-3"><strong className="block text-[12px] font-semibold tabular-nums text-text-primary">{graphStats.estimatedTokens ? graphStats.estimatedTokens.toLocaleString() : '—'}</strong><span className="mt-0.5 block text-[8px] text-text-muted">{copy(language, '预算 Tokens', 'Token budget')}</span></div>
          </div>
        </div>
      </section>
      <div className="mx-5 mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/50 bg-background">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/45 px-3.5 text-[9px] text-text-muted">
          <span className="flex items-center gap-1.5"><GitBranch className="h-3.5 w-3.5" />{copy(language, '任务依赖图', 'Task dependency graph')}</span>
          <div className="flex items-center gap-3"><span>{graphStats.models} {copy(language, '个模型配置', 'model configurations')} · {plan.executionMode === 'parallel' ? copy(language, '并行调度', 'Parallel scheduling') : copy(language, '顺序调度', 'Sequential scheduling')}</span>{!inspectorOpen && selectedTask && <button type="button" onClick={() => setInspectorOpen(true)} className="inline-flex h-6 items-center gap-1 rounded-md border border-border/55 px-2 text-[8px] text-text-secondary hover:border-accent/30 hover:text-accent"><Settings2 className="h-3 w-3" />{copy(language, '配置任务', 'Configure')}</button>}</div>
        </div>
        <div className="relative flex min-h-0 flex-1">
          <PlanDependencyGraph
            tasks={plan.tasks}
            selectedTaskId={selectedTask?.id}
            waitingApprovalTaskIds={waitingApprovalTaskIds}
            language={language}
            onSelectTask={taskId => { setSelectedTaskId(taskId); setInspectorOpen(true) }}
          />
          {inspectorOpen && selectedTask && <PlanTaskInspector task={selectedTask} tasks={plan.tasks} language={language} disabled={isLive || isPaused} onClose={() => setInspectorOpen(false)} onChange={updates => updateTask(plan.id, selectedTask.id, updates)} />}
        </div>
      </div>
      <div className="h-4 shrink-0" />
    </main> : <div className="flex min-h-0 flex-1">
      <aside className="w-[310px] shrink-0 overflow-y-auto border-r border-border/55 bg-surface/[0.08] px-3 py-3 custom-scrollbar max-lg:w-[275px]">
        <div className="mb-2 flex items-center justify-between px-1 text-[9px] font-medium text-text-muted"><span>{copy(language, '任务调度', 'Task orchestration')}</span><span>{plan.executionMode === 'parallel' ? copy(language, '并行', 'Parallel') : copy(language, '顺序', 'Serial')}</span></div>
        <div className="space-y-1">
          {plan.tasks.map((task, index) => {
            const runtime = runtimeByTask.get(task.id)
            const meta = statusMeta(task, Boolean(runtime?.waitingApproval), language)
            const Icon = meta.icon
            const active = selectedTask?.id === task.id
            const depth = depths.get(task.id) || 0
            return <div key={task.id} className="relative" style={{ paddingLeft: `${depth * 14}px` }}>
              {depth > 0 && <span className="absolute left-[3px] top-0 h-1/2 w-[10px] rounded-bl border-b border-l border-border/70" style={{ transform: `translateX(${(depth - 1) * 14}px)` }} />}
              <button onClick={() => setSelectedTaskId(task.id)} className={`relative z-[1] w-full rounded-lg border px-2.5 py-2.5 text-left transition-colors ${active ? 'border-accent/35 bg-accent/[0.065]' : 'border-transparent hover:border-border/60 hover:bg-surface/35'}`}>
                <div className="flex items-start gap-2.5"><div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${meta.bg} ${meta.tone}`}>{task.status === 'pending' && !runtime?.waitingApproval ? <span className="text-[9px] font-semibold tabular-nums">{index + 1}</span> : <Icon className={`h-3.5 w-3.5 ${task.status === 'running' && !runtime?.waitingApproval ? 'animate-spin' : ''}`} />}</div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className="truncate text-[10px] font-medium text-text-primary">{task.title}</span><span className={`shrink-0 text-[8px] ${meta.tone}`}>{meta.label}</span></div><p className="mt-1 line-clamp-2 text-[9px] leading-4 text-text-muted">{runtime?.currentTool?.name || runtime?.statusText || task.description}</p>{task.dependencies.length > 0 && <div className="mt-1.5 truncate text-[8px] text-text-muted/55">{copy(language, '依赖', 'Depends on')} · {task.dependencies.map(id => plan.tasks.find(item => item.id === id)?.title || id).join('、')}</div>}</div></div>
              </button>
            </div>
          })}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto p-5 custom-scrollbar">
        {selectedTask && <div className="mx-auto max-w-4xl">
          <section className="border-b border-border/45 pb-5">
            <div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="mb-2 flex items-center gap-2">{(() => { const meta = statusMeta(selectedTask, Boolean(selectedRuntime?.waitingApproval), language); const Icon = meta.icon; return <><Icon className={`h-3.5 w-3.5 ${meta.tone} ${selectedTask.status === 'running' && !selectedRuntime?.waitingApproval ? 'animate-spin' : ''}`} /><span className={`text-[9px] font-medium ${meta.tone}`}>{meta.label}</span>{selectedTask.startedAt && <span className="text-[8px] tabular-nums text-text-muted">{formatDuration((selectedTask.completedAt || now) - selectedTask.startedAt)}</span>}</> })()}</div><h2 className="text-[18px] font-semibold text-text-primary">{selectedTask.title}</h2><p className="mt-2 max-w-3xl text-[11px] leading-5 text-text-secondary">{selectedTask.description}</p></div>{selectedTask.threadId && <Button variant="ghost" size="sm" onClick={() => switchThread(selectedTask.threadId!)} leftIcon={<ExternalLink className="h-3.5 w-3.5" />}>{copy(language, '完整记录', 'Full log')}</Button>}</div>
            <div className="mt-4 flex flex-wrap gap-2 text-[8px] text-text-muted"><span className="rounded bg-surface/60 px-2 py-1">{selectedTask.role}</span><span className="rounded bg-surface/60 px-2 py-1">{getPlanProviderDisplayName(selectedTask.provider)} · {selectedTask.model}</span>{selectedTask.executionClass && <span className="rounded bg-surface/60 px-2 py-1">{selectedTask.executionClass}</span>}</div>
          </section>

          {plan.stageContent?.execution && <section className="border-b border-border/45 py-5">
            <PlanStageContentView content={plan.stageContent.execution} compact hideHeader />
          </section>}

          {(selectedTask.producesFiles?.length || selectedRuntime?.events.length) && <div className="grid grid-cols-2 gap-4 border-b border-border/45 py-5 max-xl:grid-cols-1">
            <section>
              <div className="mb-2.5 flex items-center gap-2 text-[10px] font-semibold text-text-secondary"><FileOutput className="h-3.5 w-3.5 text-text-muted" />{copy(language, '产出物', 'Artifacts')}</div>
              <div className="overflow-hidden rounded-xl border border-border/50">
                {(selectedTask.producesFiles || []).map(file => <div key={file} className="flex items-center gap-2 border-b border-border/35 px-3 py-2.5 last:border-0"><FileCode2 className="h-3.5 w-3.5 text-text-muted" /><span className="min-w-0 flex-1 truncate text-[10px] text-text-secondary">{file}</span>{selectedTask.status === 'running' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin text-accent" /> : selectedTask.status === 'completed' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Circle className="h-3.5 w-3.5 text-text-muted/45" />}</div>)}
                {!selectedTask.producesFiles?.length && <div className="px-3 py-5 text-center text-[9px] text-text-muted">{copy(language, '此任务未声明文件产出', 'No declared file artifacts')}</div>}
              </div>
            </section>
            <section>
              <div className="mb-2.5 flex items-center gap-2 text-[10px] font-semibold text-text-secondary"><TerminalSquare className="h-3.5 w-3.5 text-text-muted" />{copy(language, '执行日志', 'Execution log')}</div>
              <div className="max-h-60 overflow-auto rounded-xl border border-border/50 bg-surface/[0.05] px-3 py-2 custom-scrollbar">
                {selectedRuntime?.events.map(event => <div key={event.id} className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 border-b border-border/30 py-2 last:border-0"><span className="truncate font-mono text-[9px] text-text-secondary">{event.name}</span><span className="truncate text-[9px] text-text-muted">{event.detail || copy(language, '已调用', 'Invoked')}</span></div>)}
                {!selectedRuntime?.events.length && <div className="py-3 text-center text-[9px] text-text-muted">{selectedTask.status === 'pending' ? copy(language, '任务开始后将在这里显示实时动作', 'Live actions appear when the task starts') : copy(language, '暂无工具动作', 'No tool activity yet')}</div>}
              </div>
            </section>
          </div>}

          <section className="border-b border-border/45 py-4">
            <div className="mb-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-[9px] font-medium text-text-muted"><Settings2 className="h-3.5 w-3.5" />{copy(language, '执行配置', 'Execution setup')}</div>{(isLive || isPaused) && <span className="text-[8px] text-text-muted/60">{copy(language, '执行期间不可修改', 'Locked while running')}</span>}</div>
            <PlanModelSelector provider={selectedTask.provider} model={selectedTask.model} disabled={isLive || isPaused} onChange={(provider, model) => updateTask(plan.id, selectedTask.id, { provider, model })} />
            <div className="mt-2"><Select className="w-full" options={promptOptions} value={selectedTask.role} disabled={isLive || isPaused} onChange={role => updateTask(plan.id, selectedTask.id, { role })} /></div>
          </section>

          {selectedRuntime?.waitingApproval && selectedRuntime.tool && <section className="my-4 overflow-hidden rounded-lg border border-amber-400/25 bg-amber-400/[0.045]">
            <div className="flex items-start gap-3 p-4"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" /><div className="min-w-0 flex-1"><div className="text-[11px] font-semibold text-text-primary">{copy(language, '需要批准才能继续', 'Approval required')}</div><p className="mt-1 text-[9px] leading-4 text-text-muted">{copy(language, '当前任务暂停等待，其他无依赖任务仍可继续调度。', 'This task is paused while independent work continues.')}</p><div className="mt-3 rounded-md bg-background/55 p-2.5"><div className="flex items-center gap-2 text-[9px] font-medium text-text-primary"><TerminalSquare className="h-3.5 w-3.5 text-text-muted" />{selectedRuntime.tool.name}</div><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[8px] leading-4 text-text-muted">{JSON.stringify(selectedRuntime.tool.arguments, null, 2)}</pre></div></div></div>
            <div className="flex justify-end gap-2 border-t border-amber-400/15 px-3 py-2"><Button variant="danger" size="sm" onClick={() => Agent.reject(selectedTask.requestId || selectedRuntime.thread?.streamState?.requestId)} leftIcon={<X className="h-3.5 w-3.5" />}>{copy(language, '拒绝', 'Reject')}</Button><Button variant="success" size="sm" onClick={() => Agent.approve(selectedTask.requestId || selectedRuntime.thread?.streamState?.requestId)} leftIcon={<Check className="h-3.5 w-3.5" />}>{copy(language, '批准并继续', 'Approve')}</Button></div>
          </section>}

          {(selectedRuntime?.currentTool || selectedRuntime?.statusText || selectedRuntime?.latestText || selectedTask.output || selectedTask.error) && <section className="py-4">
            <div className="mb-2 text-[9px] font-medium text-text-muted">{selectedTask.error ? copy(language, '错误', 'Error') : copy(language, selectedTask.status === 'running' ? '实时动作' : '任务结果', selectedTask.status === 'running' ? 'Live activity' : 'Task result')}</div>
            {selectedRuntime?.currentTool && <div className="mb-2 flex items-center gap-2 border-y border-border/35 py-2 text-[9px] text-text-secondary"><LoaderCircle className="h-3.5 w-3.5 animate-spin text-accent" /><span className="font-medium">{selectedRuntime.currentTool.name}</span><span className="truncate text-text-muted">{selectedRuntime.statusText}</span></div>}
            <div className={`whitespace-pre-wrap break-words text-[10px] leading-5 ${selectedTask.error ? 'text-red-400' : 'text-text-secondary'}`}>{selectedTask.error || selectedRuntime?.latestText || selectedTask.output || selectedRuntime?.statusText}</div>
          </section>}
        </div>}
      </main>
    </div>}

    {showRequirements && <div className="absolute inset-0 z-40 flex justify-end bg-black/20 backdrop-blur-[1px]" onPointerDown={() => setShowRequirements(false)}><section className="flex h-full w-[min(700px,72vw)] flex-col border-l border-border bg-background shadow-2xl" onPointerDown={event => event.stopPropagation()}><div className="flex h-12 shrink-0 items-center justify-between border-b border-border/55 px-4"><div className="flex items-center gap-2 text-[11px] font-semibold text-text-primary"><FileText className="h-3.5 w-3.5 text-text-muted" />{copy(language, '需求文档', 'Plan brief')}</div><button onClick={() => setShowRequirements(false)} className="rounded-md p-1.5 text-text-muted hover:bg-surface-hover hover:text-text-primary"><X className="h-3.5 w-3.5" /></button></div><div className="relative min-h-0 flex-1 overflow-auto">{requirementsContent ? <MarkdownPreview content={requirementsContent} fontSize={13} sourcePath={workspacePath ? `${workspacePath}/.adnify/plan/${plan.requirementsDoc}` : undefined} /> : <div className="flex h-full items-center justify-center text-[10px] text-text-muted">{copy(language, '暂无需求内容', 'No brief content')}</div>}</div></section></div>}
  </div>
})

export default TaskBoard
