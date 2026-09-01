/**
 * 车道终态 → UI 投影。
 *
 * 三个消费面都需要同一份映射：Plan 的任务卡、Agent 的车道提示卡、子 Agent 的结果
 * 元信息。之前 Plan 和子 Agent 各写了一份，两边对 `outcome` 的解释并不一致 ——
 * Plan 把"归档且有冲突"映射成 `conflict`，子 Agent 直接回传原始 `outcome`，于是
 * 同一条车道在两个界面上显示成不同状态，恢复入口的判断条件也只能各写一遍。
 */
import type { ExecutionLaneProjection } from '@shared/types/executionLane'
import type { WorktreeLaneCompletion, WorktreeLaneHandle } from './WorktreeLaneService'

/** 车道刚建好、正在被执行节点使用 */
export function activeLaneProjection(lane: WorktreeLaneHandle): ExecutionLaneProjection {
  return { status: 'active', path: lane.path, branch: lane.branch, baseBranch: lane.baseBranch }
}

/**
 * 车道收尾后的投影。
 *
 * 只吃 `WorktreeLaneCompletion`（它本身就继承了车道句柄），所以调用方不需要再把
 * 原来的 handle 传第二遍 —— 那样两份 path/branch 可能对不上，反而要解释以谁为准。
 *
 * `ready` / `conflict` 表示"已归档、等人工处理"：目录被回收了，但提交还在车道分支上，
 * 所以这两个状态（以及 `failed`）是恢复面板出现的条件。已合并 / 已丢弃的车道在仓库里
 * 什么都不剩，诊断信息（`error`）也就没有意义了，不要留在投影里当噪音。
 */
export function projectLane(completion: WorktreeLaneCompletion): ExecutionLaneProjection {
  const status: ExecutionLaneProjection['status'] = completion.outcome === 'merged'
    ? 'merged'
    : completion.outcome === 'discarded'
      ? 'discarded'
      : completion.outcome === 'retained'
        ? (completion.conflicts?.length ? 'conflict' : 'ready')
        : 'failed'
  const settled = status === 'merged' || status === 'discarded'
  return {
    status,
    path: completion.path,
    branch: completion.branch,
    baseBranch: completion.baseBranch,
    commit: completion.commit,
    conflicts: completion.conflicts,
    notice: completion.notice,
    error: settled ? undefined : completion.error,
    archived: completion.archived,
  }
}

/** 车道是否还需要人工处理（提交留在分支上，等重试合并或丢弃） */
export function laneNeedsRecovery(lane: Pick<ExecutionLaneProjection, 'status'>): boolean {
  return lane.status === 'ready' || lane.status === 'conflict' || lane.status === 'failed'
}
