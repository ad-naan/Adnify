/**
 * Plan 类型定义
 *
 * 设计原则：复用现有系统，不造轮子
 * - role → 映射到 promptTemplateId
 * - provider/model → 使用现有的 providerConfigs
 */
import type { ExecutionLaneProjection } from '@/shared/types/executionLane'

// ============================================
// 任务类型
// ============================================

/** 任务状态 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled'

/** 执行模式 */
export type ExecutionMode = 'sequential' | 'parallel'

/** 计划状态 */
export type PlanStatus = 'draft' | 'approved' | 'executing' | 'pausing' | 'paused' | 'stopping' | 'stopped' | 'completed' | 'failed'

export type PlanValidationStatus = 'pending' | 'accepted' | 'changes_requested'

export type PlanStageKey = 'requirements' | 'plan' | 'execution' | 'validation'

export type PlanStageSectionKind =
    | 'overview'
    | 'list'
    | 'checklist'
    | 'decisions'
    | 'risks'
    | 'deliverables'
    | 'metrics'

export interface PlanStageContentItem {
    id: string
    title: string
    description?: string
    status?: 'pending' | 'confirmed' | 'active' | 'completed' | 'warning' | 'blocked'
}

export interface PlanStageContentSection {
    id: string
    title: string
    description?: string
    kind: PlanStageSectionKind
    items: PlanStageContentItem[]
}

export interface PlanStageContent {
    title: string
    summary: string
    sections: PlanStageContentSection[]
}

export interface PlanValidation {
    status: PlanValidationStatus
    reviewedAt?: number
}

export type TaskExecutionClass = 'analysis-read-heavy' | 'write-heavy' | 'approval-heavy' | 'general'

export interface TaskResourceScope {
    kind: 'file' | 'scope'
    value: string
}

export interface DependencySummary {
    taskId: string
    title: string
    summary: string
    status: Extract<TaskStatus, 'completed' | 'failed' | 'skipped'>
}

export type AcceptanceCriterionStatus = 'pending' | 'proven' | 'failed'
export type PlanEvidenceType = 'test' | 'diagnostic' | 'artifact' | 'diff' | 'review' | 'manual'
export type PlanEvidenceStatus = 'passed' | 'failed' | 'informational'

export interface AcceptanceCriterion {
    id: string
    text: string
    status: AcceptanceCriterionStatus
    evidenceIds: string[]
}

export interface PlanEvidence {
    id: string
    type: PlanEvidenceType
    label: string
    summary?: string
    status: PlanEvidenceStatus
    command?: string
    path?: string
    sourceThreadId?: string
    createdAt: number
}

export interface ModelOutcome {
    provider: string
    model: string
    executionClass: TaskExecutionClass
    succeeded: boolean
    duration: number
    reviewLoops: number
    recordedAt: number
}

export interface ModelRecommendation {
    provider: string
    model: string
    sampleSize: number
    successRate: number
    averageDuration: number
    reason: string
}

/** 单个任务 */
export interface PlanTask {
    id: string
    title: string
    description: string
    /** 分配的 Provider（来自 BUILTIN_PROVIDERS） */
    provider: string
    /** 分配的模型 */
    model: string
    /** 分配的角色（对应 promptTemplateId，如 'default', 'professional', 'reviewer'） */
    role: string
    /** 依赖的任务 ID */
    dependencies: string[]
    /** 任务状态 */
    status: TaskStatus
    /** 执行输出 */
    output?: string
    /** 错误信息 */
    error?: string
    /** 开始时间 */
    startedAt?: number
    /** 完成时间 */
    completedAt?: number
    /** 重试次数 */
    retryCount?: number
    /** 当前运行线程 ID */
    threadId?: string
    /** 当前运行助手消息 ID */
    assistantId?: string
    /** 当前执行请求 ID */
    requestId?: string
    /** 调度尝试次数 */
    attempt?: number
    /** 调度优先级，越大越优先 */
    priority?: number
    /** 预计消耗 token */
    estimatedTokens?: number
    /** 任务将写入的文件/资源 */
    producesFiles?: string[]
    /** 任务将读取或依赖的文件/资源 */
    consumesFiles?: string[]
    /** 执行类别，用于并发调度 */
    executionClass?: TaskExecutionClass
    /** 上游任务输出摘要，供下游任务注入上下文 */
    dependencySummary?: DependencySummary[]
    /** User-reviewable completion conditions. */
    acceptanceCriteria?: AcceptanceCriterion[]
    /** Structured proof collected while executing or reviewing the task. */
    evidence?: PlanEvidence[]
    /** Optional isolated Git worktree used by write-heavy tasks. */
    worktreeLane?: ExecutionLaneProjection
    /** Historical execution outcome used for local model recommendations. */
    modelOutcome?: ModelOutcome
    /** Auto uses local outcome history; manual preserves an explicit user choice. */
    modelSelection?: 'auto' | 'manual'
    modelRecommendation?: ModelRecommendation
}

/** 任务计划 */
export interface TaskPlan {
    id: string
    name: string
    createdAt: number
    updatedAt: number
    /** 持久化修订号，用于避免并发覆盖 */
    revision?: number
    /** 需求文档路径（相对于 .adnify/plan/） */
    requirementsDoc: string
    /** 需求文档内容（缓存，用于注入上下文） */
    requirementsContent?: string
    /** Structured, AI-authored content rendered by each Plan workspace stage. */
    stageContent?: Partial<Record<PlanStageKey, PlanStageContent>>
    /** Human-readable Markdown mirrors for auditing and external review. */
    stageDocs?: Partial<Record<PlanStageKey, string>>
    /** Version of the structured stage-content contract. */
    contentSchemaVersion?: 1
    /** 执行模式 */
    executionMode: ExecutionMode
    /** 计划状态 */
    status: PlanStatus
    /** 任务列表 */
    tasks: PlanTask[]
    /** 用户原始请求 */
    userRequest?: string
    /** 创建该计划的规划线程，用于聚合规划阶段的动态活动 */
    originThreadId?: string
    /** User review of the execution result. Persisted with the plan. */
    validation?: PlanValidation
}

// ============================================
// 执行上下文（传递给任务执行器）
// ============================================

/** 任务执行上下文 */
export interface TaskExecutionContext {
    /** 工作区路径 */
    workspacePath: string
    /** 当前计划 */
    plan: TaskPlan
    /** 当前任务 */
    task: PlanTask
    /** 已完成任务的输出（可用于传递上下文） */
    completedOutputs: Record<string, string>
    /** 依赖任务摘要（优先使用，而不是原始完整输出） */
    dependencySummary: DependencySummary[]
    /** 需求文档内容 */
    requirementsContent?: string
}

/** 任务执行结果 */
export interface TaskExecutionResult {
    taskId: string
    success: boolean
    output: string
    error?: string
    duration: number
}

/** 执行统计 */
export interface ExecutionStats {
    totalTasks: number
    completedTasks: number
    failedTasks: number
    skippedTasks: number
    totalDuration: number
    startedAt: number
    completedAt?: number
}

export interface ExecutionSessionTaskBinding {
    planId: string
    taskId: string
    threadId: string
    assistantId?: string
    requestId: string
}

export interface ExecutionSession {
    id: string
    planId: string
    workspacePath: string
    startedAt: number
    scheduler: import('./PlanScheduler').ExecutionScheduler
    status: 'running' | 'pausing' | 'paused' | 'stopping' | 'stopped' | 'completed' | 'failed'
    bindings: Map<string, ExecutionSessionTaskBinding>
    abortControllers: Map<string, AbortController>
}

// ============================================
// 事件类型
// ============================================

/** Plan 事件 */
export type PlanEvent =
    | { type: 'task:start'; taskId: string; planId: string; threadId?: string; assistantId?: string; requestId?: string }
    | { type: 'task:progress'; taskId: string; message: string }
    | { type: 'task:complete'; taskId: string; output: string; duration: number; threadId?: string; assistantId?: string; requestId?: string }
    | { type: 'task:failed'; taskId: string; error: string; threadId?: string; assistantId?: string; requestId?: string }
    | { type: 'task:skipped'; taskId: string; reason: string }
    | { type: 'plan:start'; planId: string; sessionId?: string }
    | { type: 'plan:complete'; planId: string; stats: ExecutionStats; sessionId?: string }
    | { type: 'plan:failed'; planId: string; error: string; sessionId?: string }
    | { type: 'plan:paused'; planId: string; sessionId?: string }
    | { type: 'plan:resumed'; planId: string; sessionId?: string }

// ============================================
// 配置
// ============================================

/** Plan 配置 */
export interface PlanConfig {
    /** 最大重试次数 */
    maxRetries: number
    /** 任务超时（毫秒） */
    taskTimeout: number
    /** 是否自动跳过失败依赖的任务 */
    autoSkipOnDependencyFailure: boolean
    /** 并行执行的最大并发数 */
    maxConcurrency: number
}

/** 默认配置 */
export const DEFAULT_PLAN_CONFIG: PlanConfig = {
    maxRetries: 2,
    taskTimeout: 300_000, // 5 分钟
    autoSkipOnDependencyFailure: true,
    maxConcurrency: 3,
}
