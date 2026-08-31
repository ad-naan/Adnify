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

export interface ExecutionLaneProjection {
  status: ExecutionLaneStatus
  path?: string
  branch?: string
  baseBranch?: string
  commit?: string
  conflicts?: string[]
  error?: string
  /** worktree 目录已回收（`ready` / `conflict` 时为 true） */
  archived?: boolean
}
