/**
 * 执行车道在 UI 侧的状态投影。
 *
 * - `active`：车道 worktree 正在被一个执行节点使用；
 * - `merged`：已合并回基准分支，目录与分支都已回收；
 * - `ready`：已归档 —— 目录回收了，提交留在车道分支上，等人工合并或丢弃；
 * - `conflict`：合并冲突后归档（同样只剩分支）；
 * - `discarded`：车道里没有任何提交，目录与分支一并删除；
 * - `failed`：车道自身的操作失败（提交/删除出错），需要人工检查。
 */
export type ExecutionLaneStatus = 'active' | 'ready' | 'merged' | 'conflict' | 'discarded' | 'failed'

/**
 * 车道提示的原因码。
 *
 * 车道逻辑跑在没有语言上下文的 service 层，所以它只回传原因码 + 参数，
 * 由渲染层统一翻译（见 laneNoticeText）。service 层直接拼英文句子的话，
 * UI 要么原样显示英文，要么在每个消费点再写一遍中英分支。
 */
export type ExecutionLaneNoticeCode =
  | 'noRepository'
  | 'noCommits'
  | 'dirtyBase'
  | 'createFailed'
  | 'dirtyBaseMerge'
  | 'baseBranchChanged'
  | 'conflicts'
  | 'mergeFailed'
  | 'commitFailed'
  | 'cleanupFailed'
  | 'keptForRecovery'
  | 'emptyDiscarded'
  | 'notLaneBranch'
  | 'laneStillRunning'

export interface ExecutionLaneNotice {
  code: ExecutionLaneNoticeCode
  /** 只放可序列化的值：这个结构会随 PlanTask 一起落盘 */
  params?: Record<string, string | number>
}

export interface ExecutionLaneProjection {
  status: ExecutionLaneStatus
  path?: string
  branch?: string
  baseBranch?: string
  commit?: string
  conflicts?: string[]
  /** 面向用户的原因（可翻译）；`error` 只留给日志和诊断 */
  notice?: ExecutionLaneNotice
  error?: string
  /** worktree 目录已回收（`ready` / `conflict` 时为 true） */
  archived?: boolean
}
