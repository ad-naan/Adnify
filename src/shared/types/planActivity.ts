export const PLAN_ACTIVITY_STAGES = ['requirements', 'plan', 'execution', 'validation'] as const
export const PLAN_ACTIVITY_STATUSES = ['active', 'info', 'blocked', 'completed', 'warning'] as const

export type PlanActivityStage = typeof PLAN_ACTIVITY_STAGES[number]
export type PlanActivityStatus = typeof PLAN_ACTIVITY_STATUSES[number]

/** AI-authored presentation event. Runtime task and approval state remain authoritative. */
export interface PlanActivityPayload {
  stage: PlanActivityStage
  title: string
  detail?: string
  status?: PlanActivityStatus
  taskId?: string
  progress?: number
}
