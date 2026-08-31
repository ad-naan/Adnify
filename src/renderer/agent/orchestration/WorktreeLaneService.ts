/**
 * 执行车道（Git worktree 隔离）的生命周期管理。
 *
 * 一条车道 = `<工作区>/.adnify/worktrees/<slug>-<id>` 目录 + `adnify/lane-<slug>-<id>` 分支。
 *
 * 生命周期的三种终态：
 * - **merged**：提交 → 合并回基准分支 → 删目录 + 删分支，什么都不留；
 * - **retained（归档）**：提交成功但不能合并（基准脏了 / 分支被切走 / 冲突）→
 *   删掉 worktree 目录、保留分支和提交。目录是可再生的，提交不是；留着目录只会
 *   让 `git status`、索引、文件监听持续背着一份完整检出；
 * - **discarded**：车道里没有任何超出基点的提交 → 目录和分支一起删掉。
 *
 * 归档后的分支可以在任务面板里重试合并（`retryMerge`）或彻底丢弃（`dropLane`）。
 */
import { gitService } from '@/renderer/services/gitService'
import { logger } from '@utils/Logger'
import { gitExcludeService } from '@/renderer/services/gitExcludeService'
import { ADNIFY_INTERNAL_DIR, WORKTREE_LANE_BRANCH_PREFIX, WORKTREE_LANE_DIR } from '@shared/constants'

export interface WorktreeLaneHandle {
  id: string
  workspacePath: string
  path: string
  branch: string
  baseBranch?: string
  /** 创建车道时基准分支的提交，用于判断车道是否真的产出了提交 */
  baseCommit?: string
}

/** 车道终态：合并 / 归档保留 / 无产出丢弃 / 出错 */
export type WorktreeLaneOutcome = 'merged' | 'retained' | 'discarded' | 'failed'

export interface WorktreeLaneCompletion extends WorktreeLaneHandle {
  success: boolean
  outcome: WorktreeLaneOutcome
  commit?: string
  merged?: boolean
  /** worktree 目录已回收，分支与提交仍在 */
  archived?: boolean
  conflicts?: string[]
  error?: string
}

/** 仓库里残留的车道（目录、分支，或两者都有） */
export interface RetainedLaneInfo {
  branch: string
  /** worktree 目录仍存在时给出；已归档的车道只有分支 */
  path?: string
  /** 相对当前 HEAD 领先的提交数；无法解析时为 null */
  ahead: number | null
  /** 是否是本会话仍在运行的车道 */
  active: boolean
}

/**
 * 车道目录名/分支名片段。
 *
 * 保留 Unicode 字母与数字：任务标题常常是中文，`[^a-z0-9-]` 会把它整段吃掉，
 * 结果所有中文任务的车道都叫 `task-<id>`，日志和 `git branch` 里完全认不出来。
 */
export const laneSegment = (value: string) =>
  value.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'task'

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

class WorktreeLaneServiceClass {
  private createQueue: Promise<unknown> = Promise.resolve()
  private mergeQueue: Promise<unknown> = Promise.resolve()
  /** 本会话仍在运行的车道，按 worktree 路径索引（回收时要跳过它们） */
  private readonly activeLanes = new Map<string, WorktreeLaneHandle>()
  /** 每个工作区只做一次残留回收 */
  private readonly sweptWorkspaces = new Set<string>()

  async create(workspacePath: string, label: string): Promise<WorktreeLaneHandle> {
    const run = this.createQueue.then(() => this.createNow(workspacePath, label))
    this.createQueue = run.then(() => undefined, () => undefined)
    return run
  }

  private async createNow(workspacePath: string, label: string): Promise<WorktreeLaneHandle> {
    await this.sweepOnce(workspacePath)

    if (!await gitService.isWorkingTreeClean(workspacePath)) {
      throw new Error('Cannot start an isolated parallel writer while the base workspace has uncommitted changes. Commit or stash them, or run the task exclusively.')
    }
    const id = crypto.randomUUID().slice(0, 8)
    const segment = laneSegment(label)
    const path = `${this.laneRoot(workspacePath)}/${segment}-${id}`
    const branch = `${WORKTREE_LANE_BRANCH_PREFIX}${segment}-${id}`
    const baseBranch = await gitService.getCurrentBranch(workspacePath) || undefined
    const baseCommit = await gitService.resolveCommit('HEAD', workspacePath) || undefined

    await this.ensureExcluded(workspacePath)
    const result = await gitService.createWorktree(path, branch, workspacePath)
    if (!result.success) throw new Error(result.error || 'Unable to create worktree lane')

    const handle: WorktreeLaneHandle = { id, workspacePath, path, branch, baseBranch, baseCommit }
    this.activeLanes.set(path, handle)
    logger.agent.info(`[WorktreeLane] Created ${branch} at ${path}`)
    return handle
  }

  private laneRoot(workspacePath: string): string {
    return `${workspacePath.replace(/\\/g, '/').replace(/\/$/, '')}/${WORKTREE_LANE_DIR}`
  }

  /**
   * 把整个 `.adnify/` 排除掉，而不只是 `.adnify/worktrees/`。
   *
   * 应用自己会往 `.adnify/plan/*.md`、agent 临时目录里写机器本地状态。只排除
   * worktrees 的话，任何没有把 `.adnify` 写进 .gitignore 的仓库都会因为这些文件
   * 一直是脏的 —— 于是 `isWorkingTreeClean` 永远为 false，车道功能整体不可用；
   * 而车道里的 `add -A` 又会把这些本地状态提交进合并结果。
   */
  private async ensureExcluded(workspacePath: string): Promise<void> {
    const internalDir = `${workspacePath.replace(/\\/g, '/').replace(/\/$/, '')}/${ADNIFY_INTERNAL_DIR}`
    try {
      await gitExcludeService.update(workspacePath, internalDir, true, 'add', 'exclude')
    } catch (error) {
      logger.agent.warn(`[WorktreeLane] Unable to exclude ${ADNIFY_INTERNAL_DIR}: ${errorMessage(error)}`)
    }
  }

  async complete(handle: WorktreeLaneHandle, message: string): Promise<WorktreeLaneCompletion> {
    const commit = await gitService.commitWorktree(message, handle.path)
    if (!commit.success) {
      this.activeLanes.delete(handle.path)
      return { ...handle, success: false, outcome: 'failed', error: commit.error }
    }

    // 车道里一行都没改：没有值得保留的提交，目录和分支一起收掉。
    if (commit.committed === false && !await this.hasOwnCommits(handle)) {
      const dropped = await this.drop(handle)
      return { ...handle, success: true, outcome: 'discarded', commit: commit.commit, error: dropped }
    }

    return await new Promise<WorktreeLaneCompletion>(resolve => {
      this.mergeQueue = this.mergeQueue.then(async () => {
        resolve(await this.mergeNow(handle, commit.commit))
      }).catch(async error => {
        const archived = await this.archive(handle)
        resolve({ ...handle, success: false, outcome: 'failed', commit: commit.commit, archived, error: errorMessage(error) })
      })
    })
  }

  /** 串行合并队列里的实际动作：校验基准 → 合并 → 回收目录与分支 */
  private async mergeNow(handle: WorktreeLaneHandle, commit?: string): Promise<WorktreeLaneCompletion> {
    const retain = async (error: string, conflicts?: string[]): Promise<WorktreeLaneCompletion> => {
      const archived = await this.archive(handle)
      const hint = archived
        ? `Lane ${handle.branch} is archived: the worktree folder was removed and the commit is kept on the branch.`
        : `Lane ${handle.branch} is retained at ${handle.path}.`
      return { ...handle, success: false, outcome: 'retained', commit, conflicts, archived, error: `${error} ${hint}` }
    }

    if (!await gitService.isWorkingTreeClean(handle.workspacePath)) {
      return await retain('The base workspace has uncommitted changes, so this lane could not be merged.')
    }

    // 基准分支被切走以后合并会把车道提交落到别的分支上，宁可保留。
    const currentBranch = await gitService.getCurrentBranch(handle.workspacePath) || undefined
    if (handle.baseBranch && currentBranch !== handle.baseBranch) {
      return await retain(`The workspace is now on "${currentBranch || 'a detached HEAD'}" instead of the lane base "${handle.baseBranch}", so this lane was not merged.`)
    }

    const merged = await gitService.mergeWorktreeBranch(handle.branch, handle.workspacePath)
    if (!merged.success) {
      return await retain(merged.error || 'Merge failed.', merged.conflicts)
    }

    const archived = await this.archive(handle)
    if (archived) {
      const deleted = await gitService.deleteBranch(handle.branch, false, handle.workspacePath)
      if (!deleted.success) logger.agent.warn(`[WorktreeLane] Merged ${handle.branch}, but branch cleanup failed: ${deleted.error}`)
    }
    return { ...handle, success: true, outcome: 'merged', commit, merged: true, archived }
  }

  /**
   * 放弃一条车道（失败 / 中止 / 超时）。
   *
   * 有产出就先提交再归档 —— 一个失败的执行节点仍然可能留下有用的半成品，删掉
   * 目录等于连提交历史一起烧掉；没产出就整条收掉，不给用户留垃圾分支。
   */
  async discard(handle: WorktreeLaneHandle, reason: string): Promise<WorktreeLaneCompletion> {
    const commit = await gitService.commitWorktree(`Adnify lane WIP (${reason})`, handle.path)
    const hasWork = commit.success
      ? (commit.committed !== false || await this.hasOwnCommits(handle))
      : true

    if (!hasWork) {
      const dropped = await this.drop(handle)
      logger.agent.info(`[WorktreeLane] Discarded empty lane ${handle.branch} (${reason})`)
      return { ...handle, success: true, outcome: 'discarded', commit: commit.commit, error: dropped }
    }

    const archived = await this.archive(handle)
    logger.agent.info(`[WorktreeLane] Archived lane ${handle.branch} (${reason})`)
    return {
      ...handle,
      success: false,
      outcome: 'retained',
      commit: commit.commit,
      archived,
      error: `Lane ${handle.branch} kept for recovery (${reason}).`,
    }
  }

  /** 车道分支上是否有超出基点的提交 */
  private async hasOwnCommits(handle: WorktreeLaneHandle): Promise<boolean> {
    if (!handle.baseCommit) return true
    const ahead = await gitService.countCommitsBetween(handle.baseCommit, handle.branch, handle.workspacePath)
    return ahead === null ? true : ahead > 0
  }

  /** 只回收 worktree 目录，保留分支与提交 */
  private async archive(handle: WorktreeLaneHandle): Promise<boolean> {
    this.activeLanes.delete(handle.path)
    let removed = await gitService.removeWorktree(handle.path, handle.workspacePath)
    if (!removed.success) removed = await gitService.removeWorktree(handle.path, handle.workspacePath, true)
    if (!removed.success) {
      logger.agent.warn(`[WorktreeLane] Unable to remove worktree ${handle.path}: ${removed.error}`)
      return false
    }
    // remove 之后必须 prune：否则 .git/worktrees 里的残留登记会让同名车道再也建不起来。
    await gitService.pruneWorktrees(handle.workspacePath)
    return true
  }

  /** 目录和分支一起删掉；返回错误信息（成功则 undefined） */
  private async drop(handle: WorktreeLaneHandle): Promise<string | undefined> {
    const archived = await this.archive(handle)
    if (!archived) return `Unable to remove worktree ${handle.path}`
    const deleted = await gitService.deleteBranch(handle.branch, true, handle.workspacePath)
    if (!deleted.success) {
      logger.agent.warn(`[WorktreeLane] Unable to delete lane branch ${handle.branch}: ${deleted.error}`)
      return deleted.error
    }
    return undefined
  }

  /**
   * 列出仓库里残留的车道（含已归档的纯分支），供任务面板做恢复入口。
   */
  async listLanes(workspacePath: string): Promise<RetainedLaneInfo[]> {
    const laneRoot = this.laneRoot(workspacePath)
    const [worktrees, branches] = await Promise.all([
      gitService.listWorktrees(workspacePath),
      gitService.listBranchesWithPrefix(WORKTREE_LANE_BRANCH_PREFIX, workspacePath),
    ])

    const lanes = new Map<string, RetainedLaneInfo>()
    for (const entry of worktrees) {
      if (!entry.path.startsWith(`${laneRoot}/`) || !entry.branch) continue
      lanes.set(entry.branch, { branch: entry.branch, path: entry.path, ahead: null, active: this.activeLanes.has(entry.path) })
    }
    for (const branch of branches) {
      if (!lanes.has(branch)) lanes.set(branch, { branch, ahead: null, active: false })
    }

    return await Promise.all([...lanes.values()].map(async lane => ({
      ...lane,
      ahead: await gitService.countCommitsBetween('HEAD', lane.branch, workspacePath),
    })))
  }

  /**
   * 重试合并一条归档车道（任务面板的「恢复」动作）。
   *
   * 走同一条串行合并队列，所以不会和正在结束的车道抢基准工作区。
   */
  async retryMerge(workspacePath: string, branch: string): Promise<{ success: boolean; conflicts?: string[]; error?: string }> {
    if (!branch.startsWith(WORKTREE_LANE_BRANCH_PREFIX)) return { success: false, error: `${branch} is not an Adnify lane branch` }

    return await new Promise(resolve => {
      this.mergeQueue = this.mergeQueue.then(async () => {
        if (!await gitService.isWorkingTreeClean(workspacePath)) {
          resolve({ success: false, error: 'Commit or stash the base workspace changes first.' })
          return
        }
        const merged = await gitService.mergeWorktreeBranch(branch, workspacePath)
        if (!merged.success) {
          resolve({ success: false, conflicts: merged.conflicts, error: merged.error })
          return
        }
        const deleted = await gitService.deleteBranch(branch, false, workspacePath)
        if (!deleted.success) logger.agent.warn(`[WorktreeLane] Merged ${branch}, but branch cleanup failed: ${deleted.error}`)
        resolve({ success: true })
      }).catch(error => resolve({ success: false, error: errorMessage(error) }))
    })
  }

  /**
   * 彻底丢弃一条车道：目录 + 分支都删掉，提交不可恢复。
   * 只应该由用户显式触发。
   */
  async dropLane(workspacePath: string, lane: { branch: string; path?: string }): Promise<{ success: boolean; error?: string }> {
    if (!lane.branch.startsWith(WORKTREE_LANE_BRANCH_PREFIX)) return { success: false, error: `${lane.branch} is not an Adnify lane branch` }
    if (lane.path && this.activeLanes.has(lane.path)) return { success: false, error: 'This lane is still running.' }

    if (lane.path) {
      let removed = await gitService.removeWorktree(lane.path, workspacePath)
      if (!removed.success) removed = await gitService.removeWorktree(lane.path, workspacePath, true)
      if (!removed.success) return { success: false, error: removed.error }
      await gitService.pruneWorktrees(workspacePath)
    }
    const deleted = await gitService.deleteBranch(lane.branch, true, workspacePath)
    return deleted.success ? { success: true } : { success: false, error: deleted.error }
  }

  /**
   * 会话开始后第一次建车道时，回收上次会话崩溃留下的残留。
   *
   * 只动"干净"的车道目录：清掉目录、留下分支（提交还在，随时能捞回来）。
   * 有未提交改动的残留车道一律不碰 —— 那是别人没保存的工作，让它出现在
   * `listLanes` 里由用户决定，比我们替他删掉安全。
   */
  private async sweepOnce(workspacePath: string): Promise<void> {
    if (this.sweptWorkspaces.has(workspacePath)) return
    this.sweptWorkspaces.add(workspacePath)
    try {
      await this.sweep(workspacePath)
    } catch (error) {
      logger.agent.warn(`[WorktreeLane] Sweep failed: ${errorMessage(error)}`)
    }
  }

  async sweep(workspacePath: string): Promise<{ archived: string[]; kept: string[] }> {
    await gitService.pruneWorktrees(workspacePath)
    const laneRoot = this.laneRoot(workspacePath)
    const worktrees = await gitService.listWorktrees(workspacePath)
    const archived: string[] = []
    const kept: string[] = []

    for (const entry of worktrees) {
      if (!entry.path.startsWith(`${laneRoot}/`)) continue
      if (this.activeLanes.has(entry.path)) continue
      if (!await gitService.isWorkingTreeClean(entry.path)) {
        kept.push(entry.path)
        continue
      }
      const removed = await gitService.removeWorktree(entry.path, workspacePath)
      if (removed.success) archived.push(entry.path)
      else kept.push(entry.path)
    }

    if (archived.length > 0) {
      await gitService.pruneWorktrees(workspacePath)
      logger.agent.info(`[WorktreeLane] Reclaimed ${archived.length} stale lane worktree(s); branches kept for recovery`)
    }
    if (kept.length > 0) logger.agent.warn(`[WorktreeLane] ${kept.length} stale lane worktree(s) have uncommitted changes and were left in place`)
    return { archived, kept }
  }
}

export const WorktreeLaneService = new WorktreeLaneServiceClass()
