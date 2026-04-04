/**
 * Plan 模块导出
 */

// 类型
export type {
    PlanState,
    PlanConfig,
    PlanEvent,
    TaskPlan,
    PlanTask,
    TaskStatus,
    ExecutionMode,
    PlanStatus,
    TaskExecutionContext,
    TaskExecutionResult,
    ExecutionStats,
} from './types'

export { DEFAULT_PLAN_CONFIG } from './types'

// 调度器
export { ExecutionScheduler } from './PlanScheduler'

// 执行引擎
export {
    startPlanExecution,
    stopPlanExecution,
    pausePlanExecution,
    resumePlanExecution,
    getExecutionStatus,
    getCurrentPhase,
} from './planExecutor'
