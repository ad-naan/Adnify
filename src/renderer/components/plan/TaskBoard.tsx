import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import {
    AlertTriangle,
    Check,
    CheckCircle2,
    Circle,
    ExternalLink,
    FileText,
    GitBranch,
    History,
    LoaderCircle,
    Pause,
    Play,
    Rows3,
    Settings2,
    ShieldAlert,
    Square,
    TerminalSquare,
    X,
} from 'lucide-react'
import { Button, Select } from '@/renderer/components/ui'
import { MarkdownPreview } from '@/renderer/components/editor/FilePreview'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { Agent } from '@/renderer/agent/core/Agent'
import { getMessageText } from '@/renderer/agent/types'
import { useStore } from '@/renderer/store'
import { toast } from '@/renderer/components/common/ToastProvider'
import { api } from '@/renderer/services/electronAPI'
import { BUILTIN_PROVIDERS } from '@/shared/config/providers'
import { getPromptTemplateSummary } from '@/renderer/agent/prompts/promptTemplates'
import type { ExecutionMode, PlanTask } from '@/renderer/agent/store/slices/planSlice'

interface TaskBoardProps {
    planId: string
    planOptions?: Array<{ value: string, label: string }>
    onPlanChange?: (planId: string) => void
}

const copy = (language: string, zh: string, en: string) => language === 'zh' ? zh : en

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

const ModelSelector = memo(function ModelSelector({ provider, model, onChange, disabled }: {
    provider: string
    model: string
    onChange: (provider: string, model: string) => void
    disabled?: boolean
}) {
    const providerConfigs = useStore(s => s.providerConfigs)
    const providers = useMemo(() => {
        const result: { id: string; displayName: string; models: string[] }[] = []
        for (const [id, config] of Object.entries(BUILTIN_PROVIDERS)) {
            result.push({ id, displayName: config.displayName, models: [...config.models, ...(providerConfigs[id]?.customModels || [])] })
        }
        for (const [id, config] of Object.entries(providerConfigs)) {
            if (id.startsWith('custom-')) result.push({ id, displayName: config.displayName || id, models: config.customModels || [] })
        }
        return result
    }, [providerConfigs])

    const providerOptions = useMemo(() => providers.map(item => ({ value: item.id, label: item.displayName })), [providers])
    const modelOptions = useMemo(() => Array.from(new Set(providers.find(item => item.id === provider)?.models || [])).map(value => ({ value, label: value })), [provider, providers])

    return <div className="grid grid-cols-[minmax(120px,0.7fr)_minmax(180px,1.3fr)] gap-2">
        <Select options={providerOptions} value={provider} disabled={disabled} onChange={next => onChange(next, providers.find(item => item.id === next)?.models[0] || '')} />
        <Select options={modelOptions} value={model} disabled={disabled} onChange={next => onChange(provider, next)} />
    </div>
})

const ModeToggle = memo(function ModeToggle({ mode, disabled, onChange, language }: {
    mode: ExecutionMode
    disabled: boolean
    onChange: (mode: ExecutionMode) => void
    language: string
}) {
    return <div className="inline-flex rounded-lg border border-border/70 bg-background/60 p-0.5">
        {([
            ['sequential', Rows3, copy(language, '顺序', 'Serial')],
            ['parallel', GitBranch, copy(language, '并行', 'Parallel')],
        ] as const).map(([value, Icon, label]) => <button
            key={value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(value)}
            className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-colors disabled:opacity-50 ${mode === value ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}
        >
            <Icon className="h-3.5 w-3.5" />{label}
        </button>)}
    </div>
})

export const TaskBoard = memo(function TaskBoard({ planId, planOptions = [], onPlanChange }: TaskBoardProps) {
    const language = useStore(s => s.language)
    const workspacePath = useStore(s => s.workspacePath)
    const plan = useAgentStore(s => s.plans.find(item => item.id === planId))
    const threads = useAgentStore(s => s.threads)
    const updatePlan = useAgentStore(s => s.updatePlan)
    const updateTask = useAgentStore(s => s.updateTask)
    const switchThread = useAgentStore(s => s.switchThread)
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
    const [requirementsContent, setRequirementsContent] = useState('')
    const [showRequirements, setShowRequirements] = useState(false)

    const runtimeByTask = useMemo(() => new Map((plan?.tasks || []).map(task => {
        const thread = task.threadId ? threads[task.threadId] : undefined
        const waitingApproval = thread?.streamState?.phase === 'tool_pending'
        const latestAssistant = thread ? [...thread.messages].reverse().find(message => message.role === 'assistant') : undefined
        return [task.id, {
            thread,
            waitingApproval,
            tool: waitingApproval ? thread?.streamState?.currentToolCall : undefined,
            latestText: latestAssistant?.role === 'assistant' ? getMessageText(latestAssistant.content).trim() : '',
        }] as const
    })), [plan?.tasks, threads])

    const selectedTask = plan?.tasks.find(task => task.id === selectedTaskId) || plan?.tasks[0]
    const selectedRuntime = selectedTask ? runtimeByTask.get(selectedTask.id) : undefined
    const isExecuting = plan?.status === 'executing' || plan?.status === 'pausing' || plan?.status === 'stopping'
    const isPaused = plan?.status === 'paused'

    useEffect(() => {
        if (!plan?.tasks.length) return
        const approvalTask = plan.tasks.find(task => runtimeByTask.get(task.id)?.waitingApproval)
        if (approvalTask) setSelectedTaskId(approvalTask.id)
        else if (!selectedTaskId || !plan.tasks.some(task => task.id === selectedTaskId)) setSelectedTaskId(plan.tasks[0].id)
    }, [plan?.tasks, runtimeByTask, selectedTaskId])

    useEffect(() => {
        if (!plan?.requirementsDoc || !workspacePath) return
        api.file.read(`${workspacePath}/.adnify/plan/${plan.requirementsDoc}`)
            .then(content => setRequirementsContent(content || ''))
            .catch(() => setRequirementsContent(''))
    }, [plan?.requirementsDoc, workspacePath])

    const stats = useMemo(() => {
        const tasks = plan?.tasks || []
        const completed = tasks.filter(task => task.status === 'completed').length
        const failed = tasks.filter(task => task.status === 'failed').length
        const running = tasks.filter(task => task.status === 'running').length
        const approvals = tasks.filter(task => runtimeByTask.get(task.id)?.waitingApproval).length
        return { total: tasks.length, completed, failed, running, approvals, percent: tasks.length ? Math.round((completed / tasks.length) * 100) : 0 }
    }, [plan?.tasks, runtimeByTask])

    const start = useCallback(async () => {
        if (!plan) return
        const { startPlanExecution } = await import('@/renderer/agent/plan/planExecutor')
        const result = await startPlanExecution(plan.id)
        if (!result.success) toast.error(copy(language, '启动执行失败', 'Failed to start'), result.message)
    }, [language, plan])
    const pause = useCallback(async () => (await import('@/renderer/agent/plan/planExecutor')).pausePlanExecution(planId), [planId])
    const stop = useCallback(async () => (await import('@/renderer/agent/plan/planExecutor')).stopPlanExecution(planId), [planId])
    const resume = useCallback(async () => (await import('@/renderer/agent/plan/planExecutor')).resumePlanExecution(planId), [planId])

    if (!plan) return <div className="flex h-full items-center justify-center text-sm text-text-muted">{copy(language, '计划不存在', 'Plan not found')}</div>

    return <div className="flex h-full min-h-0 flex-col bg-background">
        <header className="shrink-0 border-b border-border/55 bg-surface/[0.12] px-5 py-3.5">
            <div className="flex items-center justify-between gap-5">
                <div className="min-w-0">
                    <div className="mb-1.5 flex items-center gap-2 text-[10px] font-medium text-text-muted">
                        <span className={`h-1.5 w-1.5 rounded-full ${isExecuting ? 'animate-pulse bg-accent' : plan.status === 'completed' ? 'bg-green-500' : plan.status === 'failed' ? 'bg-red-400' : 'bg-text-muted/40'}`} />
                        <span>{plan.status === 'draft' ? copy(language, '计划审阅', 'Plan review') : plan.status === 'executing' ? copy(language, '正在执行', 'Running') : plan.status === 'completed' ? copy(language, '执行完成', 'Completed') : copy(language, '计划任务', 'Plan tasks')}</span>
                    </div>
                    <h1 className="truncate text-[17px] font-semibold leading-6 text-text-primary">{plan.name}</h1>
                    <div className="mt-1.5 flex items-center gap-3 text-[11px] text-text-muted">
                        <span>{stats.completed}/{stats.total} {copy(language, '已完成', 'complete')}</span>
                        {stats.running > 0 && <span className="text-accent">{stats.running} {copy(language, '运行中', 'running')}</span>}
                        {stats.approvals > 0 && <span className="text-amber-400">{stats.approvals} {copy(language, '待批准', 'need approval')}</span>}
                        {stats.failed > 0 && <span className="text-red-400">{stats.failed} {copy(language, '失败', 'failed')}</span>}
                    </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {planOptions.length > 1 && onPlanChange && <div className="flex min-w-0 items-center gap-1.5 rounded-lg border border-border/60 bg-background/45 pl-2 text-text-muted">
                        <History className="h-3.5 w-3.5 shrink-0" />
                        <Select className="w-[250px] border-0 bg-transparent" options={planOptions} value={plan.id} onChange={onPlanChange} />
                    </div>}
                    <ModeToggle language={language} mode={plan.executionMode} disabled={Boolean(isExecuting)} onChange={mode => updatePlan(plan.id, { executionMode: mode })} />
                    <Button variant="ghost" size="sm" onClick={() => setShowRequirements(value => !value)} leftIcon={<FileText className="h-4 w-4" />}>
                        {copy(language, '需求', 'Brief')}
                    </Button>
                    {isExecuting ? <>
                        <Button variant="secondary" size="sm" onClick={pause} disabled={plan.status !== 'executing'} leftIcon={<Pause className="h-4 w-4" />}>{copy(language, '暂停', 'Pause')}</Button>
                        <Button variant="danger" size="sm" onClick={stop} leftIcon={<Square className="h-3.5 w-3.5" />}>{copy(language, '停止', 'Stop')}</Button>
                    </> : isPaused ? <>
                        <Button size="sm" onClick={resume} leftIcon={<Play className="h-4 w-4" />}>{copy(language, '继续', 'Resume')}</Button>
                        <Button variant="danger" size="sm" onClick={stop} leftIcon={<Square className="h-3.5 w-3.5" />}>{copy(language, '停止', 'Stop')}</Button>
                    </> : <Button size="sm" onClick={start} leftIcon={<Play className="h-4 w-4" />}>{copy(language, '开始执行', 'Run plan')}</Button>}
                </div>
            </div>
            <div className="mt-3 h-0.5 overflow-hidden rounded-full bg-text-primary/[0.05]">
                <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${stats.percent}%` }} />
            </div>
        </header>

        <div className="flex min-h-0 flex-1">
            <aside className="w-[330px] shrink-0 overflow-y-auto border-r border-border/60 bg-surface/[0.12] p-3">
                <div className="mb-2 px-2 text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{copy(language, '任务队列', 'Task queue')}</div>
                <div className="space-y-1.5">
                    {plan.tasks.map((task, index) => {
                        const runtime = runtimeByTask.get(task.id)
                        const meta = statusMeta(task, Boolean(runtime?.waitingApproval), language)
                        const Icon = meta.icon
                        const active = selectedTask?.id === task.id
                        return <button key={task.id} onClick={() => setSelectedTaskId(task.id)} className={`w-full rounded-xl border p-3 text-left transition-colors ${active ? 'border-accent/35 bg-accent/[0.07]' : 'border-transparent hover:border-border/70 hover:bg-surface/50'}`}>
                            <div className="flex items-start gap-3">
                                <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${meta.bg} ${meta.tone}`}>
                                    {task.status === 'pending' && !runtime?.waitingApproval ? <span className="text-[10px] font-semibold tabular-nums">{index + 1}</span> : <Icon className={`h-4 w-4 ${task.status === 'running' && !runtime?.waitingApproval ? 'animate-spin' : ''}`} />}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="truncate text-sm font-medium text-text-primary">{task.title}</span>
                                        <span className={`shrink-0 text-[10px] font-medium ${meta.tone}`}>{meta.label}</span>
                                    </div>
                                    <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-text-muted">{runtime?.tool ? copy(language, `请求执行 ${runtime.tool.name}`, `Requests ${runtime.tool.name}`) : task.description}</p>
                                </div>
                            </div>
                        </button>
                    })}
                </div>
            </aside>

            <main className="min-w-0 flex-1 overflow-y-auto p-5">
                {selectedTask && <div className="mx-auto max-w-4xl space-y-4">
                    <section className="overflow-hidden rounded-2xl border border-border/55 bg-surface/[0.16]">
                        <div className="p-5">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <div className="mb-2 flex items-center gap-2">
                                    {(() => { const meta = statusMeta(selectedTask, Boolean(selectedRuntime?.waitingApproval), language); const Icon = meta.icon; return <><Icon className={`h-4 w-4 ${meta.tone} ${selectedTask.status === 'running' && !selectedRuntime?.waitingApproval ? 'animate-spin' : ''}`} /><span className={`text-xs font-medium ${meta.tone}`}>{meta.label}</span></> })()}
                                </div>
                                <h2 className="text-xl font-semibold text-text-primary">{selectedTask.title}</h2>
                                <p className="mt-2 max-w-3xl text-sm leading-6 text-text-secondary">{selectedTask.description}</p>
                            </div>
                            {selectedTask.threadId && <Button variant="ghost" size="sm" onClick={() => switchThread(selectedTask.threadId!)} leftIcon={<ExternalLink className="h-3.5 w-3.5" />}>{copy(language, '完整记录', 'Full log')}</Button>}
                        </div>
                        </div>
                        <div className="border-t border-border/40 bg-background/20 px-5 py-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2 text-[10px] font-medium text-text-muted"><Settings2 className="h-3.5 w-3.5" />{copy(language, '执行配置', 'Execution setup')}</div>
                                {isExecuting && <span className="text-[9px] text-text-muted/65">{copy(language, '执行期间不可修改', 'Locked while running')}</span>}
                            </div>
                            <ModelSelector provider={selectedTask.provider} model={selectedTask.model} disabled={Boolean(isExecuting)} onChange={(provider, model) => updateTask(plan.id, selectedTask.id, { provider, model })} />
                            <div className="mt-2">
                                <Select className="w-full" options={getPromptTemplateSummary().map(item => ({ value: item.id, label: item.nameZh || item.name }))} value={selectedTask.role} disabled={Boolean(isExecuting)} onChange={role => updateTask(plan.id, selectedTask.id, { role })} />
                            </div>
                        </div>
                    </section>

                    {selectedRuntime?.waitingApproval && selectedRuntime.tool && <section className="rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] p-5 shadow-[0_12px_40px_-28px_rgba(251,191,36,0.7)]">
                        <div className="flex items-start gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-400/15 text-amber-400"><ShieldAlert className="h-5 w-5" /></div>
                            <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold text-text-primary">{copy(language, '需要批准才能继续', 'Approval required')}</div>
                                <p className="mt-1 text-xs leading-5 text-text-muted">{copy(language, '该任务已暂停计时，其他可并行任务会继续调度。', 'This task timeout is paused while other independent work continues.')}</p>
                                <div className="mt-4 rounded-xl border border-border/60 bg-background/60 p-3">
                                    <div className="flex items-center gap-2 text-xs font-medium text-text-primary"><TerminalSquare className="h-4 w-4 text-text-muted" />{selectedRuntime.tool.name}</div>
                                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-5 text-text-muted">{JSON.stringify(selectedRuntime.tool.arguments, null, 2)}</pre>
                                </div>
                                <div className="mt-4 flex gap-2">
                                    <Button variant="success" size="sm" onClick={() => Agent.approve(selectedTask.requestId || selectedRuntime.thread?.streamState?.requestId)} leftIcon={<Check className="h-4 w-4" />}>{copy(language, '批准并继续', 'Approve')}</Button>
                                    <Button variant="danger" size="sm" onClick={() => Agent.reject(selectedTask.requestId || selectedRuntime.thread?.streamState?.requestId)} leftIcon={<X className="h-4 w-4" />}>{copy(language, '拒绝', 'Reject')}</Button>
                                </div>
                            </div>
                        </div>
                    </section>}

                    {(selectedRuntime?.latestText || selectedTask.output || selectedTask.error) && <section className="rounded-2xl border border-border/60 bg-background/40 p-5">
                        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-text-muted">{selectedTask.error ? copy(language, '错误', 'Error') : copy(language, '最新进展', 'Latest progress')}</div>
                        <div className={`whitespace-pre-wrap text-sm leading-6 ${selectedTask.error ? 'text-red-300' : 'text-text-secondary'}`}>{selectedTask.error || selectedRuntime?.latestText || selectedTask.output}</div>
                    </section>}
                </div>}
            </main>
        </div>

        {showRequirements && <div className="absolute inset-0 z-40 flex justify-end bg-black/35 backdrop-blur-[2px]" onClick={() => setShowRequirements(false)}>
            <section className="flex h-full w-[min(720px,70vw)] flex-col border-l border-border bg-background shadow-2xl" onClick={event => event.stopPropagation()}>
                <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
                    <div className="flex items-center gap-2 text-sm font-semibold text-text-primary"><FileText className="h-4 w-4 text-text-muted" />{copy(language, '需求文档', 'Plan brief')}</div>
                    <Button variant="icon" size="icon" onClick={() => setShowRequirements(false)} aria-label={copy(language, '关闭', 'Close')}><X className="h-4 w-4" /></Button>
                </div>
                <div className="relative min-h-0 flex-1 overflow-auto">{requirementsContent ? <MarkdownPreview content={requirementsContent} fontSize={13} sourcePath={workspacePath ? `${workspacePath}/.adnify/plan/${plan.requirementsDoc}` : undefined} /> : <div className="flex h-full items-center justify-center text-sm text-text-muted">{copy(language, '暂无需求内容', 'No brief content')}</div>}</div>
            </section>
        </div>}
    </div>
})

export default TaskBoard
