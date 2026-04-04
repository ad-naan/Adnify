/**
 * 执行调度器
 *
 * 职责：
 * - 确定可执行的任务（依赖已满足）
 * - 支持顺序和并行执行
 * - 处理任务失败和依赖传播
 */

import { logger } from '@utils/Logger'
import type {
    TaskPlan,
    PlanTask,
    TaskExecutionResult,
    ExecutionStats,
    PlanConfig,
    DependencySummary,
} from './types'
import { DEFAULT_PLAN_CONFIG } from './types'

const EXECUTION_CLASS_WEIGHT: Record<NonNullable<PlanTask['executionClass']>, number> = {
    'analysis-read-heavy': 4,
    general: 3,
    'approval-heavy': 2,
    'write-heavy': 1,
}

const normalizeExecutionClass = (task: PlanTask): NonNullable<PlanTask['executionClass']> => {
    if (task.executionClass) return task.executionClass
    return 'general'
}

const getPriority = (task: PlanTask): number => task.priority ?? 0
const getEstimatedTokens = (task: PlanTask): number => task.estimatedTokens ?? Number.MAX_SAFE_INTEGER

const collectResourceKeys = (task: PlanTask): string[] => {
    const keys = new Set<string>()
    for (const file of task.producesFiles || []) keys.add(`write:${file}`)
    for (const file of task.consumesFiles || []) keys.add(`read:${file}`)
    return Array.from(keys)
}

const hasConflict = (task: PlanTask, selected: PlanTask[]): boolean => {
    const taskWrites = new Set(task.producesFiles || [])
    const taskReads = new Set(task.consumesFiles || [])

    if (normalizeExecutionClass(task) === 'write-heavy') {
        return selected.length > 0
    }

    if (normalizeExecutionClass(task) === 'approval-heavy') {
        const approvalTasks = selected.filter(candidate => normalizeExecutionClass(candidate) === 'approval-heavy')
        if (approvalTasks.length >= 1) return true
    }

    for (const candidate of selected) {
        const candidateWrites = new Set(candidate.producesFiles || [])
        const candidateReads = new Set(candidate.consumesFiles || [])

        for (const file of taskWrites) {
            if (candidateWrites.has(file) || candidateReads.has(file)) return true
        }

        for (const file of taskReads) {
            if (candidateWrites.has(file)) return true
        }
    }

    return false
}

export class ExecutionScheduler {
    private config: PlanConfig
    private runningTasks: Set<string> = new Set()
    private paused = false
    private stopped = false

    constructor(config: Partial<PlanConfig> = {}) {
        this.config = { ...DEFAULT_PLAN_CONFIG, ...config }
    }

    getExecutableTasks(plan: TaskPlan): PlanTask[] {
        if (this.paused || this.stopped) return []

        const executable: PlanTask[] = []

        for (const task of plan.tasks) {
            if (task.status !== 'pending') continue
            if (this.runningTasks.has(task.id)) continue

            const depStatus = this.checkDependencies(task, plan)

            if (depStatus === 'ready') {
                executable.push({
                    ...task,
                    dependencySummary: this.buildDependencySummary(task, plan),
                    executionClass: normalizeExecutionClass(task),
                })
            } else if (depStatus === 'blocked' && this.config.autoSkipOnDependencyFailure) {
                this.markTaskSkipped(task, 'Dependency failed or skipped')
            }
        }

        return executable
    }

    private checkDependencies(task: PlanTask, plan: TaskPlan): 'ready' | 'waiting' | 'blocked' {
        if (task.dependencies.length === 0) return 'ready'

        let allCompleted = true

        for (const depId of task.dependencies) {
            const depTask = plan.tasks.find(t => t.id === depId)
            if (!depTask) {
                logger.agent.warn(`[Scheduler] Dependency not found: ${depId}`)
                continue
            }

            if (depTask.status === 'failed' || depTask.status === 'skipped') {
                return 'blocked'
            }

            if (depTask.status !== 'completed') {
                allCompleted = false
            }
        }

        return allCompleted ? 'ready' : 'waiting'
    }

    private buildDependencySummary(task: PlanTask, plan: TaskPlan): DependencySummary[] {
        return task.dependencies
            .map(depId => plan.tasks.find(t => t.id === depId))
            .filter((depTask): depTask is PlanTask => Boolean(depTask))
            .filter(depTask => depTask.status === 'completed' || depTask.status === 'failed' || depTask.status === 'skipped')
            .map(depTask => ({
                taskId: depTask.id,
                title: depTask.title,
                summary: (depTask.output || depTask.error || '').slice(0, 600),
                status: depTask.status as DependencySummary['status'],
            }))
    }

    private markTaskSkipped(task: PlanTask, reason: string): void {
        task.status = 'skipped'
        task.error = reason
        task.completedAt = Date.now()
        logger.agent.info(`[Scheduler] Task skipped: ${task.id} - ${reason}`)
    }

    getNextTask(plan: TaskPlan): PlanTask | null {
        const executable = this.rankTasks(this.getExecutableTasks(plan))
        return executable[0] || null
    }

    start(): void {
        this.paused = false
        this.stopped = false
        this.runningTasks.clear()
    }

    stop(): void {
        this.stopped = true
        this.paused = false
        this.runningTasks.clear()
    }

    pause(): void {
        this.paused = true
    }

    resume(): void {
        this.paused = false
        this.stopped = false
    }

    get isAborted(): boolean {
        return this.stopped
    }

    markTaskRunning(task: PlanTask): void {
        task.status = 'running'
        task.startedAt = Date.now()
        task.attempt = (task.attempt || 0) + 1
        task.executionClass = normalizeExecutionClass(task)
        this.runningTasks.add(task.id)
    }

    markTaskCompleted(task: PlanTask, output: string): TaskExecutionResult {
        const duration = Date.now() - (task.startedAt || Date.now())
        task.status = 'completed'
        task.output = output
        task.error = undefined
        task.completedAt = Date.now()
        this.runningTasks.delete(task.id)

        return { taskId: task.id, success: true, output, duration }
    }

    markTaskFailed(task: PlanTask, error: string): TaskExecutionResult {
        const duration = Date.now() - (task.startedAt || Date.now())
        task.status = 'failed'
        task.error = error
        task.completedAt = Date.now()
        this.runningTasks.delete(task.id)

        return { taskId: task.id, success: false, output: '', error, duration }
    }

    isComplete(plan: TaskPlan): boolean {
        return plan.tasks.every(t =>
            t.status === 'completed' || t.status === 'failed' || t.status === 'skipped'
        )
    }

    hasRunningTasks(): boolean {
        return this.runningTasks.size > 0
    }

    calculateStats(plan: TaskPlan, startedAt: number): ExecutionStats {
        const tasks = plan.tasks
        return {
            totalTasks: tasks.length,
            completedTasks: tasks.filter(t => t.status === 'completed').length,
            failedTasks: tasks.filter(t => t.status === 'failed').length,
            skippedTasks: tasks.filter(t => t.status === 'skipped').length,
            totalDuration: Date.now() - startedAt,
            startedAt,
            completedAt: this.isComplete(plan) ? Date.now() : undefined,
        }
    }

    getParallelBatch(plan: TaskPlan): PlanTask[] {
        const ranked = this.rankTasks(this.getExecutableTasks(plan))
        const selected: PlanTask[] = []
        const resourceKeys = new Set<string>()

        for (const task of ranked) {
            if (selected.length >= this.config.maxConcurrency) break
            if (hasConflict(task, selected)) continue

            const nextKeys = collectResourceKeys(task)
            const writeHeavyCount = selected.filter(candidate => normalizeExecutionClass(candidate) === 'write-heavy').length
            const approvalHeavyCount = selected.filter(candidate => normalizeExecutionClass(candidate) === 'approval-heavy').length

            if (normalizeExecutionClass(task) === 'write-heavy' && writeHeavyCount >= 1) continue
            if (normalizeExecutionClass(task) === 'approval-heavy' && approvalHeavyCount >= 1) continue

            let collides = false
            for (const key of nextKeys) {
                if (resourceKeys.has(key)) {
                    collides = true
                    break
                }
            }
            if (collides) continue

            selected.push(task)
            for (const key of nextKeys) resourceKeys.add(key)
        }

        return selected
    }

    private rankTasks(tasks: PlanTask[]): PlanTask[] {
        return [...tasks].sort((a, b) => {
            const priorityDiff = getPriority(b) - getPriority(a)
            if (priorityDiff !== 0) return priorityDiff

            const classDiff = EXECUTION_CLASS_WEIGHT[normalizeExecutionClass(b)] - EXECUTION_CLASS_WEIGHT[normalizeExecutionClass(a)]
            if (classDiff !== 0) return classDiff

            const tokenDiff = getEstimatedTokens(a) - getEstimatedTokens(b)
            if (tokenDiff !== 0) return tokenDiff

            return a.id.localeCompare(b.id)
        })
    }
}
