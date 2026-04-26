/**
 * Plan 执行引擎
 *
 * 职责：
 * - 启动/停止计划执行
 * - 为每个任务创建执行上下文
 * - 调用现有 Agent 系统执行任务
 * - 更新任务状态到 Store
 *
 * 设计原则：
 * - 复用 buildAgentSystemPrompt() 构建提示词
 * - 复用 Agent.send() 执行任务
 * - task.role 映射到 promptTemplateId
 * - task.provider + task.model 直接使用
 */

import { useAgentStore } from '../store/AgentStore'
import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { EventBus } from '../core/EventBus'
import { Agent } from '../core/Agent'
import { gitService } from '@/renderer/services/gitService'
import { ExecutionScheduler } from './PlanScheduler'
import { getLLMConfigForTask } from '../services/llmConfigService'
import {
    DEFAULT_PLAN_CONFIG,
    type TaskPlan,
    type PlanTask,
    type ExecutionStats,
    type ExecutionSession,
    type ExecutionSessionTaskBinding,
    type DependencySummary,
} from './types'

const sessions = new Map<string, ExecutionSession>()
const planToSessionId = new Map<string, string>()

function getSessionByPlanId(planId: string): ExecutionSession | null {
    const sessionId = planToSessionId.get(planId)
    if (!sessionId) return null
    return sessions.get(sessionId) || null
}

function createSession(planId: string, workspacePath: string): ExecutionSession {
    const sessionId = crypto.randomUUID()
    const session: ExecutionSession = {
        id: sessionId,
        planId,
        workspacePath,
        startedAt: Date.now(),
        scheduler: new ExecutionScheduler(),
        status: 'running',
        bindings: new Map(),
        abortControllers: new Map(),
    }
    session.scheduler.start()
    sessions.set(sessionId, session)
    planToSessionId.set(planId, sessionId)
    return session
}

function clearSession(session: ExecutionSession): void {
    session.scheduler.stop()
    sessions.delete(session.id)
    if (planToSessionId.get(session.planId) === session.id) {
        planToSessionId.delete(session.planId)
    }
}

function bindTaskRun(
    session: ExecutionSession,
    taskId: string,
    binding: ExecutionSessionTaskBinding,
): void {
    session.bindings.set(taskId, binding)
    useAgentStore.getState().updateTask(session.planId, taskId, {
        threadId: binding.threadId,
        assistantId: binding.assistantId,
        requestId: binding.requestId,
    })
}

function abortSessionRuns(session: ExecutionSession): void {
    for (const binding of session.bindings.values()) {
        Agent.abort(binding.threadId)
    }
}

function isCancellationReason(reason?: string): boolean {
    return reason === 'aborted' || reason === 'user_rejected' || reason === 'Aborted'
}

async function validatePlanTaskModels(plan: TaskPlan): Promise<string | null> {
    for (const task of plan.tasks) {
        if (task.status !== 'pending') continue
        const config = await getLLMConfigForTask(task.provider, task.model)
        if (!config) {
            return `Task "${task.title}" has invalid LLM config: ${task.provider}/${task.model}`
        }
    }

    return null
}

function createTaskThreadBinding(_task: PlanTask) {
    const store = useAgentStore.getState()
    const threadId = store.createThread({ activate: false })
    const requestId = crypto.randomUUID()
    return { threadId, requestId }
}

function getTaskOutput(threadId: string, assistantId: string): string {
    const thread = useAgentStore.getState().threads[threadId]
    if (!thread) return ''

    const assistantMessage = thread.messages.find(message => message.id === assistantId)
    if (assistantMessage?.role === 'assistant') {
        return assistantMessage.content || ''
    }

    const lastAssistant = [...thread.messages].reverse().find(message => message.role === 'assistant')
    return lastAssistant?.role === 'assistant' ? lastAssistant.content || '' : ''
}

function waitForAgentCompletion(
    identity: { threadId: string; assistantId?: string; requestId: string; taskId: string },
    timeoutMs = DEFAULT_PLAN_CONFIG.taskTimeout,
): Promise<{ success: boolean; output: string; error?: string; assistantId?: string }> {
    return new Promise((resolve) => {
        let settled = false
        let timer: ReturnType<typeof setTimeout> | null = null

        const cleanup = () => {
            if (timer) {
                clearTimeout(timer)
                timer = null
            }
            unsubscribe()
        }

        const settle = (result: { success: boolean; output: string; error?: string; assistantId?: string }) => {
            if (settled) return
            settled = true
            cleanup()
            resolve(result)
        }

        const unsubscribe = EventBus.on('loop:end', (event) => {
            if (event.threadId !== identity.threadId) return
            if (identity.assistantId && event.assistantId !== identity.assistantId) return
            if (event.requestId !== identity.requestId) return
            if (event.planTaskId && event.planTaskId !== identity.taskId) return

            const assistantId = event.assistantId || identity.assistantId
            const output = assistantId
                ? getTaskOutput(identity.threadId, assistantId) || 'Task execution completed'
                : 'Task execution completed'
            if (event.reason === 'error' || event.reason === 'aborted' || event.reason === 'loop_detected' || event.reason === 'max_iterations') {
                settle({ success: false, output: '', error: event.reason, assistantId })
                return
            }

            settle({ success: true, output, assistantId })
        })

        timer = setTimeout(() => {
            settle({ success: false, output: '', error: `Agent execution timed out after ${timeoutMs}ms` })
        }, timeoutMs)
    })
}

export async function startPlanExecution(
    planId?: string
): Promise<{ success: boolean; message: string }> {
    const store = useAgentStore.getState()

    let plan = planId
        ? store.plans.find(p => p.id === planId)
        : store.getActivePlan()

    if (!plan) {
        return { success: false, message: 'No active plan found' }
    }

    if (plan.tasks.length === 0) {
        return { success: false, message: 'Plan has no tasks' }
    }

    if (getSessionByPlanId(plan.id)) {
        return { success: false, message: 'Plan is already executing' }
    }

    const hasPendingTasks = plan.tasks.some(task => task.status === 'pending')
    const hasRetryableTasks = plan.tasks.some(task =>
        task.status === 'failed' || task.status === 'skipped' || task.status === 'running' || task.status === 'cancelled'
    )

    if (!hasPendingTasks && hasRetryableTasks) {
        store.resetTasksForExecution(plan.id)
        plan = store.getPlan(plan.id) || plan
    }

    if (!plan.tasks.some(task => task.status === 'pending')) {
        return { success: false, message: 'Plan has no pending tasks to execute' }
    }

    const workspacePath = gitService.getWorkspace()
    if (!workspacePath) {
        return { success: false, message: 'No workspace open' }
    }

    const validationError = await validatePlanTaskModels(plan)
    if (validationError) {
        return { success: false, message: validationError }
    }

    try {
        const requirementsPath = `${workspacePath}/.adnify/plan/${plan.requirementsDoc}`
        const requirementsContent = await api.file.read(requirementsPath)
        store.updatePlan(plan.id, { requirementsContent: requirementsContent || undefined })
    } catch (e) {
        logger.agent.warn('[PlanExecutor] Failed to load requirements document:', e)
    }

    const session = createSession(plan.id, workspacePath)
    store.startExecution(plan.id)

    logger.agent.info(`[PlanExecutor] Started execution of plan: ${plan.name}`)
    EventBus.emit({ type: 'plan:start', planId: plan.id, sessionId: session.id })

    runExecutionLoop(session).catch(error => {
        logger.agent.error('[PlanExecutor] Execution loop failed:', error)
        handleExecutionError(session, error)
    })

    return {
        success: true,
        message: `Started executing plan "${plan.name}" with ${plan.tasks.length} tasks.`
    }
}

export function stopPlanExecution(planId?: string): void {
    const store = useAgentStore.getState()
    const plan = planId ? store.getPlan(planId) : store.getActivePlan()
    if (!plan) return

    const session = getSessionByPlanId(plan.id)
    if (!session) return

    session.status = 'stopping'
    session.scheduler.stop()
    abortSessionRuns(session)
    store.stopExecution(plan.id, 'stopped')
    if (session.bindings.size === 0) {
        clearSession(session)
    }
    logger.agent.info('[PlanExecutor] Execution stopped')
}

export function pausePlanExecution(planId?: string): void {
    const store = useAgentStore.getState()
    const plan = planId ? store.getPlan(planId) : store.getActivePlan()
    if (!plan) return

    const session = getSessionByPlanId(plan.id)
    if (!session) return

    session.status = 'pausing'
    session.scheduler.pause()
    abortSessionRuns(session)

    store.updatePlan(plan.id, { status: 'pausing' })
    if (session.bindings.size === 0) {
        session.status = 'paused'
        store.pauseExecution(plan.id)
        clearSession(session)
    }
    EventBus.emit({ type: 'plan:paused', planId: plan.id, sessionId: session.id })
    logger.agent.info('[PlanExecutor] Execution paused')
}

export async function resumePlanExecution(planId?: string): Promise<void> {
    const store = useAgentStore.getState()
    const plan = planId ? store.getPlan(planId) : store.getActivePlan()
    const workspacePath = gitService.getWorkspace()

    if (!plan || !workspacePath) return

    const session = getSessionByPlanId(plan.id) || createSession(plan.id, workspacePath)
    session.status = 'running'
    session.scheduler.resume()
    store.resumeExecution(plan.id)

    EventBus.emit({ type: 'plan:resumed', planId: plan.id, sessionId: session.id })

    runExecutionLoop(session).catch(error => {
        logger.agent.error('[PlanExecutor] Resume failed:', error)
        handleExecutionError(session, error)
    })
}

export function getExecutionStatus(): {
    isRunning: boolean
    stats: ExecutionStats | null
} {
    const store = useAgentStore.getState()
    const plan = store.getActivePlan()
    if (!plan) {
        return { isRunning: false, stats: null }
    }

    const session = getSessionByPlanId(plan.id)
    if (!session) {
        return { isRunning: false, stats: null }
    }

    return {
        isRunning: session.status === 'running',
        stats: session.scheduler.calculateStats(plan, session.startedAt)
    }
}

export function getCurrentPhase(): 'planning' | 'executing' {
    const state = useAgentStore.getState()
    const activePlan = state.getActivePlan()
    return activePlan?.status === 'executing' || activePlan?.status === 'pausing' || activePlan?.status === 'stopping'
        ? 'executing'
        : 'planning'
}

async function runExecutionLoop(session: ExecutionSession): Promise<void> {
    const store = useAgentStore.getState()

    while (session.status === 'running' && !session.scheduler.isAborted) {
        const plan = store.getPlan(session.planId)
        if (!plan) {
            throw new Error(`Plan ${session.planId} not found during execution`)
        }

        if (plan.executionMode === 'parallel') {
            const batch = session.scheduler.getParallelBatch(plan)
            if (batch.length === 0) {
                if (session.scheduler.isComplete(plan) || !session.scheduler.hasRunningTasks()) {
                    await completeExecution(session, plan)
                }
                break
            }
            await Promise.all(batch.map(task => executeTask(session, task, plan)))
        } else {
            const task = session.scheduler.getNextTask(plan)
            if (!task) {
                if (session.scheduler.isComplete(plan) || !session.scheduler.hasRunningTasks()) {
                    await completeExecution(session, plan)
                }
                break
            }
            await executeTask(session, task, plan)
        }
    }
}

async function executeTask(
    session: ExecutionSession,
    task: PlanTask,
    plan: TaskPlan,
): Promise<void> {
    const store = useAgentStore.getState()
    const existingTask = store.getPlan(plan.id)?.tasks.find(candidate => candidate.id === task.id) || task
    const { threadId, requestId } = createTaskThreadBinding(existingTask)
    bindTaskRun(session, existingTask.id, {
        planId: plan.id,
        taskId: existingTask.id,
        threadId,
        requestId,
    })

    session.scheduler.markTaskRunning(existingTask)
    store.setCurrentTask(existingTask.id)
    store.updateTask(plan.id, existingTask.id, {
        status: 'running',
        startedAt: Date.now(),
        threadId,
        requestId,
        attempt: (existingTask.attempt || 0) + 1,
        dependencySummary: existingTask.dependencySummary,
        executionClass: existingTask.executionClass,
    })

    EventBus.emit({
        type: 'task:start',
        taskId: existingTask.id,
        planId: plan.id,
        threadId,
        requestId,
    })

    logger.agent.info(`[PlanExecutor] Executing task: ${existingTask.title}`)

    try {
        const result = await runTaskWithAgent(session, existingTask, store.getPlan(plan.id) || plan, threadId, requestId)

        if (!result.success && isCancellationReason(result.error)) {
            session.scheduler.markTaskPending(existingTask)
            store.updateTask(plan.id, existingTask.id, {
                status: 'pending',
                error: undefined,
                startedAt: undefined,
                completedAt: undefined,
            })

            if (session.status === 'pausing') {
                session.status = 'paused'
                store.pauseExecution(plan.id)
                EventBus.emit({ type: 'plan:paused', planId: plan.id, sessionId: session.id })
                clearSession(session)
                return
            }

            if (session.status === 'stopping') {
                session.status = 'stopped'
                store.stopExecution(plan.id, 'stopped')
                clearSession(session)
                return
            }
        }

        if (result.success) {
            session.scheduler.markTaskCompleted(existingTask, result.output)
            store.markTaskCompleted(plan.id, existingTask.id, result.output)
            store.updateTask(plan.id, existingTask.id, {
                threadId: result.threadId,
                assistantId: result.assistantId,
                requestId: result.requestId,
            })

            EventBus.emit({
                type: 'task:complete',
                taskId: existingTask.id,
                output: result.output,
                duration: Date.now() - (existingTask.startedAt || Date.now()),
                threadId: result.threadId,
                assistantId: result.assistantId,
                requestId: result.requestId,
            })
        } else {
            session.scheduler.markTaskFailed(existingTask, result.error || 'Unknown error')
            store.markTaskFailed(plan.id, existingTask.id, result.error || 'Unknown error')
            store.updateTask(plan.id, existingTask.id, {
                threadId: result.threadId,
                assistantId: result.assistantId,
                requestId: result.requestId,
            })

            EventBus.emit({
                type: 'task:failed',
                taskId: existingTask.id,
                error: result.error || 'Unknown error',
                threadId: result.threadId,
                assistantId: result.assistantId,
                requestId: result.requestId,
            })
        }
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        session.scheduler.markTaskFailed(existingTask, errorMsg)
        store.markTaskFailed(plan.id, existingTask.id, errorMsg)
        EventBus.emit({ type: 'task:failed', taskId: existingTask.id, error: errorMsg, threadId, requestId })
        logger.agent.error(`[PlanExecutor] Task execution error: ${existingTask.title}`, error)
    } finally {
        session.bindings.delete(existingTask.id)
        session.abortControllers.delete(existingTask.id)
        if (store.currentTaskId === existingTask.id) {
            store.setCurrentTask(null)
        }
    }
}

async function completeExecution(session: ExecutionSession, plan: TaskPlan): Promise<void> {
    const stats = session.scheduler.calculateStats(plan, session.startedAt)
    const hasFailures = stats.failedTasks > 0

    const store = useAgentStore.getState()
    store.stopExecution(plan.id, hasFailures ? 'failed' : 'completed')

    session.status = hasFailures ? 'failed' : 'completed'
    EventBus.emit({ type: 'plan:complete', planId: plan.id, stats, sessionId: session.id })
    clearSession(session)

    logger.agent.info('[PlanExecutor] Execution complete:', stats)
}

function handleExecutionError(session: ExecutionSession, error: unknown): void {
    const errorMsg = error instanceof Error ? error.message : String(error)
    const store = useAgentStore.getState()
    store.stopExecution(session.planId, 'failed')

    session.status = 'failed'
    EventBus.emit({ type: 'plan:failed', planId: session.planId, error: errorMsg, sessionId: session.id })
    clearSession(session)

    logger.agent.error('[PlanExecutor] Plan execution failed:', errorMsg)
}

async function runTaskWithAgent(
    session: ExecutionSession,
    task: PlanTask,
    plan: TaskPlan,
    threadId: string,
    requestId: string,
): Promise<{ success: boolean; output: string; error?: string; threadId: string; assistantId?: string; requestId: string }> {
    try {
        const isCoderTask = /coder|developer|engineer/i.test(task.role || '')
        const maxReviewLoops = 3
        let currentLoop = 0
        let currentRole = task.role || 'default'
        let feedbackMessage = buildTaskMessage(task, plan)
        let finalOutput = ''
        let lastAssistantId: string | undefined
        let activeRequestId = requestId

        while (currentLoop < maxReviewLoops && session.status === 'running') {
            const llmConfig = await getLLMConfigForTask(task.provider, task.model)
            if (!llmConfig) {
                return { success: false, output: '', error: `Failed to get LLM config for ${task.provider}/${task.model}`, threadId, requestId: activeRequestId }
            }

            const templateId = mapRoleToTemplateId(currentRole)
            logger.agent.info(`[PlanExecutor] Emitting subtask. Loop: ${currentLoop}, Role: ${currentRole} (Template: ${templateId})`)

            if (session.status !== 'running') {
                return { success: false, output: '', error: 'aborted', threadId, requestId: activeRequestId }
            }

            const completionPromise = waitForAgentCompletion({
                threadId,
                requestId: activeRequestId,
                taskId: task.id,
            })

            const sendPromise = Agent.send(
                feedbackMessage,
                llmConfig,
                session.workspacePath,
                'agent',
                {
                    promptTemplateId: templateId,
                    planPhase: 'executing',
                },
                {
                    threadId,
                    requestId: activeRequestId,
                    planTaskId: task.id,
                }
            ).then(
                execution => ({ execution }),
                error => ({ error })
            )

            const firstOutcome = await Promise.race([
                completionPromise.then(result => ({ result })),
                sendPromise,
            ])

            if ('error' in firstOutcome) {
                const errorMsg = firstOutcome.error instanceof Error ? firstOutcome.error.message : String(firstOutcome.error)
                return { success: false, output: '', error: errorMsg, threadId, requestId: activeRequestId }
            }

            const sendOutcome = 'execution' in firstOutcome ? firstOutcome : await sendPromise
            if ('error' in sendOutcome) {
                const errorMsg = sendOutcome.error instanceof Error ? sendOutcome.error.message : String(sendOutcome.error)
                return { success: false, output: '', error: errorMsg, threadId, requestId: activeRequestId }
            }

            const execution = sendOutcome.execution
            const result = 'result' in firstOutcome ? firstOutcome.result : await completionPromise
            lastAssistantId = result.assistantId || execution.assistantId
            activeRequestId = execution.requestId
            bindTaskRun(session, task.id, {
                planId: plan.id,
                taskId: task.id,
                threadId: execution.threadId,
                assistantId: lastAssistantId,
                requestId: execution.requestId,
            })

            if (!result.success) {
                return { ...result, threadId: execution.threadId, assistantId: lastAssistantId, requestId: execution.requestId }
            }

            finalOutput = result.output

            if (isCoderTask) {
                if (currentRole !== 'reviewer') {
                    currentRole = 'reviewer'
                    feedbackMessage = `[System: Reviewer Phase]\nCoder has completed the sequence for task: "${task.title}".\nPlease verify the latest changes. Use reading tools if necessary. If everything is fully correct and meets requirements without regressions, output exactly <LGTM>. Otherwise, point out the exact logical flaws or remaining steps.`
                    currentLoop++
                } else if (finalOutput.includes('<LGTM>')) {
                    break
                } else {
                    currentRole = task.role || 'coder'
                    feedbackMessage = `[System: Coder Phase]\nReviewer found issues or missing steps:\n\n${finalOutput}\n\nPlease address these issues and continue working on the task.`
                    currentLoop++
                }
            } else {
                break
            }
        }

        return { success: true, output: finalOutput, threadId, assistantId: lastAssistantId, requestId: activeRequestId }
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        return { success: false, output: '', error: errorMsg, threadId, requestId }
    }
}

function buildTaskMessage(task: PlanTask, plan: TaskPlan): string {
    const lines: string[] = []

    lines.push('# Task Execution Request')
    lines.push('')
    lines.push(`## Task: ${task.title}`)
    lines.push('')
    lines.push('### Description')
    lines.push(task.description)
    lines.push('')

    if (plan.requirementsContent) {
        lines.push('### Requirements Context')
        lines.push('')
        const truncated = plan.requirementsContent.length > 3000
            ? plan.requirementsContent.slice(0, 3000) + '\n\n... (truncated)'
            : plan.requirementsContent
        lines.push(truncated)
        lines.push('')
    }

    const dependencySummaries = (task.dependencySummary || buildDependencySummaryFromPlan(task, plan))
        .filter(summary => Boolean(summary.summary))

    if (dependencySummaries.length > 0) {
        lines.push('### Dependency Summaries')
        lines.push('')
        for (const summary of dependencySummaries) {
            lines.push(`- **${summary.title}** [${summary.status}]: ${summary.summary}`)
        }
        lines.push('')
    }

    lines.push('### Instructions')
    lines.push('')
    lines.push('1. Execute this task completely')
    lines.push('2. Use all available tools as needed')
    lines.push('3. When finished, provide a clear summary of what you accomplished')
    lines.push('4. Do NOT ask for user confirmation - just execute')
    lines.push('')
    lines.push('### Important')
    lines.push(`- You are part of plan: "${plan.name}"`)
    lines.push(`- Bound identity: planId=${plan.id}, taskId=${task.id}, threadId=${task.threadId || 'pending'}, requestId=${task.requestId || 'pending'}`)
    lines.push('- Focus ONLY on this specific task')
    lines.push('- Be thorough and handle edge cases')

    return lines.join('\n')
}

function buildDependencySummaryFromPlan(task: PlanTask, plan: TaskPlan): DependencySummary[] {
    return task.dependencies
        .map(depId => plan.tasks.find(t => t.id === depId))
        .filter((depTask): depTask is PlanTask => Boolean(depTask))
        .map(depTask => ({
            taskId: depTask.id,
            title: depTask.title,
            summary: (depTask.output || depTask.error || '').slice(0, 600),
            status: (depTask.status === 'completed' || depTask.status === 'failed' || depTask.status === 'skipped')
                ? depTask.status
                : 'completed',
        }))
}

function mapRoleToTemplateId(role: string): string {
    const r = role.toLowerCase()
    if (r.includes('frontend') || r.includes('backend') || r.includes('developer') || r.includes('coder') || r.includes('engineer')) {
        return 'coder'
    }
    if (r.includes('architect') || r.includes('system design')) {
        return 'architect'
    }
    if (r.includes('ui') || r.includes('ux') || r.includes('designer') || r.includes('visual')) {
        return 'uiux-designer'
    }
    if (r.includes('analyst') || r.includes('research') || r.includes('gather') || r.includes('planning')) {
        return 'analyst'
    }
    if (r.includes('review') || r.includes('audit') || r.includes('careful')) {
        return 'reviewer'
    }
    if (r.includes('concise') || r.includes('efficient') || r.includes('minimal')) {
        return 'concise'
    }
    return role
}
