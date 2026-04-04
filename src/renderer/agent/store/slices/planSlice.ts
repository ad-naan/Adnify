/**
 * Plan State Management
 * 管理任务规划、执行状态
 *
 * 重构：使用新的 plan 模块类型
 */

import { StateCreator } from 'zustand'
import type { AgentStore } from '../AgentStore'
import type {
    PlanState as ControllerState,
    TaskPlan,
    PlanTask,
    TaskStatus,
    ExecutionMode,
    PlanStatus,
} from '../../plan/types'
import { useStore } from '@store'

export type { TaskStatus, ExecutionMode, PlanStatus, PlanTask, TaskPlan }
export type PlanTaskStatus = TaskStatus
export type PlanPhase = 'planning' | 'executing'

export interface PlanSliceState {
    plans: TaskPlan[]
    activePlanId: string | null
    phase: PlanPhase
    isExecuting: boolean
    currentTaskId: string | null
    controllerState: ControllerState
}

export interface PlanSliceActions {
    addPlan: (plan: TaskPlan) => void
    setActivePlan: (planId: string | null) => void
    updatePlan: (planId: string, updates: Partial<TaskPlan>) => void
    deletePlan: (planId: string) => void
    setPlans: (plans: TaskPlan[]) => void
    loadPlansFromDisk: (workspacePath: string) => Promise<void>

    updateTask: (planId: string, taskId: string, updates: Partial<PlanTask>) => void
    markTaskCompleted: (planId: string, taskId: string, output: string) => void
    markTaskFailed: (planId: string, taskId: string, error: string) => void
    markTaskSkipped: (planId: string, taskId: string, reason: string) => void

    setPhase: (phase: PlanPhase) => void
    setControllerState: (state: ControllerState) => void
    startExecution: (planId: string) => void
    pauseExecution: () => void
    resumeExecution: () => void
    stopExecution: () => void
    setCurrentTask: (taskId: string | null) => void

    getActivePlan: () => TaskPlan | null
    getPlan: (planId: string) => TaskPlan | null
    getNextPendingTask: (planId: string) => PlanTask | null
    getExecutableTasks: (planId: string) => PlanTask[]
    savePlan: (planId: string) => Promise<void>
}

export type PlanSlice = PlanSliceState & PlanSliceActions

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const latestQueuedRevision = new Map<string, number>()
const SAVE_DEBOUNCE_MS = 120

function withRevision(plan: TaskPlan, updates?: Partial<TaskPlan>): TaskPlan {
    const nextRevision = Math.max(plan.revision || 0, updates?.revision || 0) + 1
    return {
        ...plan,
        ...updates,
        revision: nextRevision,
        updatedAt: Date.now(),
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
    phase: 'planning' as PlanPhase,
    isExecuting: false,
    currentTaskId: null,
    controllerState: 'idle' as ControllerState,

    addPlan: (plan) => {
        const planWithRevision = { ...plan, revision: plan.revision || 1 }
        set((state) => ({
            plans: [...state.plans, planWithRevision],
            activePlanId: plan.id,
            phase: 'planning' as PlanPhase,
            controllerState: 'reviewing' as ControllerState,
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
        set((state) => ({
            plans: state.plans.filter((p) => p.id !== planId),
            activePlanId: state.activePlanId === planId ? null : state.activePlanId,
        }))
    },

    setPlans: (plans) => {
        set({ plans })
    },

    loadPlansFromDisk: async (workspacePath) => {
        try {
            const { api } = await import('@/renderer/services/electronAPI')
            const planDir = `${workspacePath}/.adnify/plan`
            const exists = await api.file.exists(planDir)
            if (!exists) return

            const files = await api.file.readDir(planDir)
            if (!files || !Array.isArray(files) || files.length === 0) return

            const jsonFiles = files
                .filter((f: any) => {
                    const name = typeof f === 'string' ? f : f.name
                    const isDir = typeof f === 'string' ? false : f.isDirectory
                    return !isDir && name.endsWith('.json')
                })
                .map((f: any) => typeof f === 'string' ? f : f.name)

            const plans: TaskPlan[] = []

            for (const file of jsonFiles) {
                try {
                    const content = await api.file.read(`${planDir}/${file}`)
                    if (content) {
                        const plan = JSON.parse(content) as TaskPlan
                        if (plan.id && plan.name && Array.isArray(plan.tasks)) {
                            plans.push({ ...plan, revision: plan.revision || 1 })
                        }
                    }
                } catch (e) {
                    console.warn(`[PlanSlice] Failed to load plan: ${file}`, e)
                }
            }

            if (plans.length > 0) {
                plans.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
                set({ plans })
            }
        } catch (e) {
            console.warn('[PlanSlice] Failed to load plans from disk:', e)
        }
    },

    savePlan: async (planId) => {
        const plan = get().plans.find(p => p.id === planId)
        if (!plan) return

        latestQueuedRevision.set(planId, plan.revision || 1)
        const existingTimer = saveTimers.get(planId)
        if (existingTimer) clearTimeout(existingTimer)

        await new Promise<void>((resolve) => {
            const timer = setTimeout(async () => {
                saveTimers.delete(planId)
                try {
                    const latestPlan = get().plans.find(p => p.id === planId)
                    if (!latestPlan) return

                    const requestedRevision = latestQueuedRevision.get(planId) || 0
                    if ((latestPlan.revision || 0) < requestedRevision) {
                        resolve()
                        return
                    }

                    const workspacePath = useStore.getState().workspacePath
                    if (!workspacePath) return

                    const { api } = await import('@/renderer/services/electronAPI')
                    const planPath = `${workspacePath}/.adnify/plan/${planId}.json`
                    await api.file.write(planPath, JSON.stringify(latestPlan, null, 2))
                } catch (error) {
                    console.error('[PlanSlice] Failed to save plan:', error)
                } finally {
                    resolve()
                }
            }, SAVE_DEBOUNCE_MS)
            saveTimers.set(planId, timer)
        })
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

    setPhase: (phase) => {
        set({ phase })
    },

    setControllerState: (controllerState) => {
        set({ controllerState })
    },

    startExecution: (planId) => {
        const plan = get().plans.find(p => p.id === planId)
        if (!plan) return

        set((state) => ({
            isExecuting: true,
            phase: 'executing' as PlanPhase,
            controllerState: 'executing' as ControllerState,
            currentTaskId: null,
            plans: state.plans.map((p) =>
                p.id === planId
                    ? withRevision(p, { status: 'executing' as PlanStatus })
                    : p
            ),
        }))
    },

    pauseExecution: () => {
        const state = get()
        if (!state.activePlanId) return

        set((prev) => ({
            isExecuting: false,
            controllerState: 'paused' as ControllerState,
            plans: prev.plans.map((p) =>
                p.id === state.activePlanId
                    ? withRevision(p, { status: 'paused' as PlanStatus })
                    : p
            ),
        }))
    },

    resumeExecution: () => {
        const state = get()
        if (!state.activePlanId) return

        set((prev) => ({
            isExecuting: true,
            controllerState: 'executing' as ControllerState,
            plans: prev.plans.map((p) =>
                p.id === state.activePlanId
                    ? withRevision(p, { status: 'executing' as PlanStatus })
                    : p
            ),
        }))
    },

    stopExecution: () => {
        set({
            isExecuting: false,
            currentTaskId: null,
            phase: 'planning' as PlanPhase,
            controllerState: 'idle' as ControllerState,
        })
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
