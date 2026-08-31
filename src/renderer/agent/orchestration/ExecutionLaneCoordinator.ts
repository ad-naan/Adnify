/**
 * 决定一个执行节点（顶层 Agent 运行 / 可写子 agent / Plan 任务）跑在共享工作区
 * 还是独立车道里，并负责把车道交回去。
 *
 * 隔离粒度是执行节点而不是消息：一个执行节点从开始到结束只看见一份工作区快照。
 */
import { gitService } from '@/renderer/services/gitService'
import { WorktreeLaneService, type WorktreeLaneCompletion, type WorktreeLaneHandle } from './WorktreeLaneService'
import { logger } from '@utils/Logger'

export type ExecutionNodeKind = 'agent-session' | 'sub-agent' | 'plan-task'

export interface ExecutionLaneIntent {
  kind: ExecutionNodeKind
  workspacePath: string | null
  label: string
  mayWrite: boolean
  concurrent: boolean
  /**
   * 拿不到车道时是否允许退回共享工作区。
   *
   * 顶层会话开 true：用户在聊天框里连发两条消息不是"并行写任务"的申明，为此
   * 直接失败会把一次正常对话变成报错。子 agent / Plan 并行是真的并行写，拿不到
   * 隔离必须硬失败，否则两个写者会互相覆盖。
   */
  allowSharedFallback?: boolean
}

export interface ExecutionLaneAssignment {
  workspacePath: string | null
  isolated: boolean
  lane?: WorktreeLaneHandle
  /** 本该隔离但退回了共享工作区的原因（需要提示用户） */
  fallbackReason?: string
}

class ExecutionLaneCoordinatorClass {
  async acquire(intent: ExecutionLaneIntent): Promise<ExecutionLaneAssignment> {
    if (!intent.workspacePath || !intent.mayWrite || !intent.concurrent) {
      return { workspacePath: intent.workspacePath, isolated: false }
    }

    const blocker = await this.findBlocker(intent.workspacePath)
    if (blocker) return this.fallbackOrThrow(intent, blocker)

    try {
      const lane = await WorktreeLaneService.create(intent.workspacePath, intent.label)
      return { workspacePath: lane.path, isolated: true, lane }
    } catch (error) {
      return this.fallbackOrThrow(intent, error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * 车道不可用的前置原因。
   *
   * 不能用 `getCurrentBranch` 的真假来判断"是不是 Git 仓库"：detached HEAD 和
   * 空仓库都会返回空，前者其实完全可以建车道，后者根本没有 HEAD 可以作为基点，
   * 两种情况给出的提示也应该不一样。
   */
  private async findBlocker(workspacePath: string): Promise<string | null> {
    if (!await gitService.isInsideWorkTree(workspacePath)) {
      return 'Isolated parallel writing requires a Git repository.'
    }
    if (!await gitService.hasCommits(workspacePath)) {
      return 'Isolated parallel writing requires at least one commit to branch from.'
    }
    return null
  }

  private fallbackOrThrow(intent: ExecutionLaneIntent, reason: string): ExecutionLaneAssignment {
    if (!intent.allowSharedFallback) {
      throw new Error(`${reason} Run this task exclusively instead (${intent.kind}).`)
    }
    logger.agent.warn(`[ExecutionLane] ${intent.kind} falling back to the shared workspace: ${reason}`)
    return { workspacePath: intent.workspacePath, isolated: false, fallbackReason: reason }
  }

  async complete(assignment: ExecutionLaneAssignment, message: string): Promise<WorktreeLaneCompletion | null> {
    return assignment.lane ? WorktreeLaneService.complete(assignment.lane, message) : null
  }

  /**
   * 执行节点失败 / 中止 / 超时时归还车道。
   *
   * 不走这一步的话，worktree 目录和分支会永久留在仓库里，而且下一条车道会因为
   * 基准工作区被残留状态弄脏而建不起来 —— 一次失败会拖垮后续所有并行执行。
   */
  async release(assignment: ExecutionLaneAssignment | undefined | null, reason: string): Promise<WorktreeLaneCompletion | null> {
    if (!assignment?.lane) return null
    try {
      return await WorktreeLaneService.discard(assignment.lane, reason)
    } catch (error) {
      logger.agent.warn(`[ExecutionLane] Unable to release lane ${assignment.lane.branch}: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }
}

export const ExecutionLaneCoordinator = new ExecutionLaneCoordinatorClass()
