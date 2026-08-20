/**
 * Plan State Management
 * 管理任务规划、执行状态
 *
 * 重构：使用新的 plan 模块类型
 */

import { StateCreator } from 'zustand'
import type { AgentStore } from '../AgentStore'
import type {
    TaskPlan,
    PlanTask,
    TaskStatus,
    ExecutionMode,
    PlanStatus,
} from '../../plan/types'
import { useStore } from '@store'
import { api } from '@/renderer/services/electronAPI'
import { planStorageRepository } from '@/renderer/services/planStorageRepository'

export type { TaskStatus, ExecutionMode, PlanStatus, PlanTask, TaskPlan }
export type PlanTaskStatus = TaskStatus

export interface PlanSliceState {
    plans: TaskPlan[]
    activePlanId: string | null
    currentTaskId: string | null
}

export interface PlanSliceActions {
    addPlan: (plan: TaskPlan) => void
    setActivePlan: (planId: string | null) => void
    updatePlan: (planId: string, updates: Partial<TaskPlan>) => void
    deletePlan: (planId: string) => void
    setPlans: (plans: TaskPlan[]) => void
    loadPlansFromStorage: () => Promise<void>

    updateTask: (planId: string, taskId: string, updates: Partial<PlanTask>) => void
    markTaskCompleted: (planId: string, taskId: string, output: string) => void
    markTaskFailed: (planId: string, taskId: string, error: string) => void
    markTaskSkipped: (planId: string, taskId: string, reason: string) => void
    resetTasksForExecution: (planId: string, options?: { includeCompleted?: boolean }) => void

    startExecution: (planId: string) => void
    pauseExecution: (planId?: string) => void
    resumeExecution: (planId?: string) => void
    stopExecution: (planId?: string, nextStatus?: PlanStatus) => void
    setCurrentTask: (taskId: string | null) => void

    getActivePlan: () => TaskPlan | null
    getPlan: (planId: string) => TaskPlan | null
    getNextPendingTask: (planId: string) => PlanTask | null
    getExecutableTasks: (planId: string) => PlanTask[]
    savePlan: (planId: string) => Promise<void>
}

export type PlanSlice = PlanSliceState & PlanSliceActions

function withRevision(plan: TaskPlan, updates?: Partial<TaskPlan>): TaskPlan {
    const nextRevision = Math.max(plan.revision || 0, updates?.revision || 0) + 1
    return {
        ...plan,
        ...updates,
        revision: nextRevision,
        updatedAt: Date.now(),
    }
}

function normalizeLoadedPlan(plan: TaskPlan): TaskPlan {
    const interruptedPlanStatuses: PlanStatus[] = ['executing', 'pausing', 'stopping']
    const wasInterrupted = interruptedPlanStatuses.includes(plan.status)

    return {
        ...plan,
        status: wasInterrupted ? 'paused' : plan.status,
        tasks: plan.tasks.map(task => (
            task.status === 'running'
                ? {
                    ...task,
                    status: 'pending',
                    error: undefined,
                    startedAt: undefined,
                    completedAt: undefined,
                }
                : task
        )),
    }
}

export const createPlanSlice: StateCreator<
    AgentStore,
    [],
    [],
    PlanSlice
> = (set, get) => ({
    plans: [],
    activePlanId: null,
    currentTaskId: null,

    addPlan: (plan) => {
        const planWithRevision = { ...plan, revision: plan.revision || 1 }
        set((state) => ({
            plans: [...state.plans, planWithRevision],
            activePlanId: plan.id,
        }))
    },

    setActivePlan: (planId) => {
        set({ activePlanId: planId })
    },

    updatePlan: (planId, updates) => {
        set((state) => ({
            plans: state.plans.map((p) =>
                p.id === planId ? withRevision(p, updates) : p
            ),
        }))
        void get().savePlan(planId)
    },

    deletePlan: (planId) => {
        const plan = get().plans.find(p => p.id === planId)

        // Cascade to the hidden plan-task threads this plan spawned. They are
        // excluded from the sidebar by `isTopLevelThreadForMode`, so if they are
        // not removed here the user can never reach them again — they would only
        // ever be reclaimed by the 50-thread FIFO eviction.
        const orphanThreadIds = Object.values(get().threads)
            .filter(thread => thread.origin === 'plan-task' && thread.planId === planId)
            .map(thread => thread.id)

        set((state) => ({
            plans: state.plans.filter((p) => p.id !== planId),
            activePlanId: state.activePlanId === planId ? null : state.activePlanId,
            currentTaskId: state.activePlanId === planId ? null : state.currentTaskId,
        }))

        for (const threadId of orphanThreadIds) {
            get().deleteThread(threadId)
        }

        // The repository drains any queued write before deleting the
        // authoritative SQLite row, then legacy JSON and Markdown artifacts.
        void (async () => {
            await planStorageRepository.delete(planId)
            const workspacePath = useStore.getState().workspacePath
            if (!workspacePath) return

            const planDir = `${workspacePath}/.adnify/plan`
            const targets = [`${planDir}/${planId}.json`]
            if (plan?.requirementsDoc) targets.push(`${planDir}/${plan.requirementsDoc}`)
            for (const stageDoc of Object.values(plan?.stageDocs || {})) {
                const target = `${planDir}/${stageDoc}`
                if (!targets.includes(target)) targets.push(target)
            }

            for (const target of targets) {
                try {
                    if (await api.file.exists(target)) await api.file.delete(target)
                } catch (error) {
                    console.warn(`[PlanSlice] Failed to delete plan file: ${target}`, error)
                }
            }
        })()
    },

    setPlans: (plans) => {
        set({ plans })
    },

    loadPlansFromStorage: async () => {
        try {
            set({ plans: [], activePlanId: null })
            await api.session.open()
            const stored = await api.session.loadPlans()
            const plans = stored
                .filter((value): value is TaskPlan => Boolean(
                    value && typeof value === 'object' &&
                    typeof (value as TaskPlan).id === 'string' &&
                    typeof (value as TaskPlan).name === 'string' &&
                    Array.isArray((value as TaskPlan).tasks),
                ))
                .map(plan => normalizeLoadedPlan({ ...plan, revision: plan.revision || 1 }))

            if (plans.length > 0) {
                plans.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
                set({ plans })
            }
        } catch (e) {
            console.warn('[PlanSlice] Failed to load plans from SQLite:', e)
            set({ plans: [], activePlanId: null })
        }
    },

    savePlan: async (planId) => {
        const plan = get().plans.find(p => p.id === planId)
        if (!plan) return
        planStorageRepository.stage(plan)
    },

    updateTask: (planId, taskId, updates) => {
        set((state) => ({
            plans: state.plans.map((plan) => {
                if (plan.id !== planId) return plan
                return withRevision(plan, {
                    tasks: plan.tasks.map((task) =>
                        task.id === taskId ? { ...task, ...updates } : task
                    ),
                })
            }),
        }))
        void get().savePlan(planId)
    },

    markTaskCompleted: (planId, taskId, output) => {
        get().updateTask(planId, taskId, {
            status: 'completed',
            output,
            error: undefined,
            completedAt: Date.now(),
        })
    },

    markTaskFailed: (planId, taskId, error) => {
        get().updateTask(planId, taskId, {
            status: 'failed',
            error,
            completedAt: Date.now(),
        })
    },

    markTaskSkipped: (planId, taskId, reason) => {
        get().updateTask(planId, taskId, {
            status: 'skipped',
            error: reason,
            completedAt: Date.now(),
        })
    },

    resetTasksForExecution: (planId, options) => {
        const includeCompleted = options?.includeCompleted === true

        set((state) => ({
            plans: state.plans.map((plan) => {
                if (plan.id !== planId) return plan

                return withRevision(plan, {
                    status: 'approved',
                    validation: undefined,
                    tasks: plan.tasks.map((task) => {
                        if (task.status === 'completed' && !includeCompleted) {
                            return task
                        }

                        return {
                            ...task,
                            status: 'pending',
                            error: undefined,
                            output: includeCompleted ? undefined : task.output,
                            startedAt: undefined,
                            completedAt: undefined,
                            threadId: undefined,
                            assistantId: undefined,
                            requestId: undefined,
                            dependencySummary: undefined,
                            executionClass: undefined,
                        }
                    }),
                })
            }),
            currentTaskId: null,
        }))
        void get().savePlan(planId)
    },

    startExecution: (planId) => {
        const plan = get().plans.find(p => p.id === planId)
        if (!plan) return

        set((state) => ({
            currentTaskId: null,
            plans: state.plans.map((p) =>
                p.id === planId
                    ? withRevision(p, { status: 'executing' as PlanStatus, validation: undefined })
                    : p
            ),
        }))
        void get().savePlan(planId)
    },

    pauseExecution: (planId) => {
        const state = get()
        const targetPlanId = planId || state.activePlanId
        if (!targetPlanId) return

        set((prev) => ({
            plans: prev.plans.map((p) =>
                p.id === targetPlanId
                    ? withRevision(p, { status: 'paused' as PlanStatus })
                    : p
            ),
        }))
        void get().savePlan(targetPlanId)
    },

    resumeExecution: (planId) => {
        const state = get()
        const targetPlanId = planId || state.activePlanId
        if (!targetPlanId) return

        set((prev) => ({
            plans: prev.plans.map((p) =>
                p.id === targetPlanId
                    ? withRevision(p, { status: 'executing' as PlanStatus })
                    : p
            ),
        }))
        void get().savePlan(targetPlanId)
    },

    stopExecution: (planId, nextStatus = 'approved') => {
        const state = get()
        const targetPlanId = planId || state.activePlanId

        set((prev) => ({
            currentTaskId: null,
            plans: targetPlanId
                ? prev.plans.map((plan) =>
                    plan.id === targetPlanId
                        ? withRevision(plan, { status: nextStatus })
                        : plan
                )
                : prev.plans,
        }))

        if (targetPlanId) {
            void get().savePlan(targetPlanId)
        }
    },

    setCurrentTask: (taskId) => {
        set({ currentTaskId: taskId })
    },

    getActivePlan: () => {
        const state = get()
        return state.plans.find((p) => p.id === state.activePlanId) || null
    },

    getPlan: (planId) => {
        return get().plans.find((p) => p.id === planId) || null
    },

    getNextPendingTask: (planId) => {
        const tasks = get().getExecutableTasks(planId)
        return tasks[0] || null
    },

    getExecutableTasks: (planId) => {
        const state = get()
        const plan = state.plans.find((p) => p.id === planId)
        if (!plan) return []

        const executable: PlanTask[] = []

        for (const task of plan.tasks) {
            if (task.status !== 'pending') continue

            let allDepsCompleted = true
            let anyDepFailed = false

            for (const depId of task.dependencies) {
                const depTask = plan.tasks.find((t) => t.id === depId)
                if (!depTask) continue

                if (depTask.status === 'failed' || depTask.status === 'skipped') {
                    anyDepFailed = true
                    break
                }

                if (depTask.status !== 'completed') {
                    allDepsCompleted = false
                }
            }

            if (anyDepFailed) continue
            if (allDepsCompleted) executable.push(task)
        }

        return executable
    },
})
