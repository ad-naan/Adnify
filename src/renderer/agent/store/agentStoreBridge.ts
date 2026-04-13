import { useAgentStore } from './AgentStore'
import type { PlanTask, TaskPlan } from './slices/planSlice'

export interface AgentStorePlanBridge {
  addPlan: (plan: TaskPlan) => void
  updatePlan: (planId: string, updates: Partial<TaskPlan>) => void
  updateTask: (planId: string, taskId: string, updates: Partial<PlanTask>) => void
  getActivePlan: () => TaskPlan | null
  getPlanById: (planId: string) => TaskPlan | null
  getPlans: () => TaskPlan[]
}

export interface AgentStoreTodoBridge {
  setTodos: (todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm: string }>) => void
}

function getStoreState() {
  return useAgentStore.getState()
}

export const agentStorePlanBridge: AgentStorePlanBridge = {
  addPlan(plan) {
    getStoreState().addPlan(plan)
  },

  updatePlan(planId, updates) {
    getStoreState().updatePlan(planId, updates)
  },

  updateTask(planId, taskId, updates) {
    getStoreState().updateTask(planId, taskId, updates)
  },

  getActivePlan() {
    return getStoreState().getActivePlan()
  },

  getPlanById(planId) {
    return getStoreState().plans.find(plan => plan.id === planId) || null
  },

  getPlans() {
    return getStoreState().plans
  },
}

export const agentStoreTodoBridge: AgentStoreTodoBridge = {
  setTodos(todos) {
    getStoreState().setTodos(todos)
  },
}
