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
import { normalizePath, pathEquals, pathStartsWith } from '@shared/utils/pathUtils'
import type { ExecutionLaneNotice, ExecutionLaneNoticeCode } from '@shared/types/executionLane'

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
  /** 面向用户的原因码，由渲染层翻译（laneNoticeText） */
  notice?: ExecutionLaneNotice
  /** Git 原始报错，只用于日志与诊断 */
  error?: string
}

/**
 * 车道建不起来时抛出的错误。
 *
 * 带上原因码，这样调用方（ExecutionLaneCoordinator）不需要去解析英文句子就能给出
 * 可翻译的提示；`message` 仍然是英文，因为它进日志和异常栈。
 */
export class LaneUnavailableError extends Error {
  constructor(message: string, readonly notice: ExecutionLaneNotice) {
    super(message)
    this.name = 'LaneUnavailableError'
  }
}

const notice = (code: ExecutionLaneNoticeCode, params?: Record<string, string | number>): ExecutionLaneNotice =>
  params ? { code, params } : { code }


/** 恢复动作（重试合并 / 丢弃）的结果 */
export interface LaneActionResult {
  success: boolean
  conflicts?: string[]
  /** 面向用户的原因码 */
  notice?: ExecutionLaneNotice
  /** Git 原始报错，只用于日志与诊断 */
  error?: string
}

/**
 * 车道目录名/分支名片段。
 *
 * 保留 Unicode 字母与数字：任务标题常常是中文，`[^a-z0-9-]` 会把它整段吃掉，
 * 结果所有中文任务的车道都叫 `task-<id>`，日志和 `git branch` 里完全认不出来。
 */
const laneSegment = (value: string) =>
  value.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'task'

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

class WorktreeLaneServiceClass {
  private createQueue: Promise<unknown> = Promise.resolve()
  private mergeQueue: Promise<unknown> = Promise.resolve()
  /**
   * 本会话仍在运行的车道，按 worktree 路径索引（回收时要跳过它们）。
   *
   * key 必须过 `laneKey`：注册时用的是我们自己拼出来的路径，查找时用的是
   * `git worktree list` 报出来的路径，两者在 Windows 上大小写常常不一致
   * （用户从最近项目里打开的是 `d:/repo`，Git 记的是 `D:/Repo`）。直接用原始
   * 字符串做 key，回收逻辑会把正在写入的车道当成残留删掉。
   */
  private readonly activeLanes = new Map<string, WorktreeLaneHandle>()
  /** 每个工作区只做一次残留回收（同样按归一化路径索引） */
  private readonly sweptWorkspaces = new Set<string>()

  /** 路径 → Map/Set 的 key：统一分隔符与大小写 */
  private laneKey(path: string): string {
    return normalizePath(path).toLowerCase()
  }

  async create(workspacePath: string, label: string): Promise<WorktreeLaneHandle> {
    const run = this.createQueue.then(() => this.createNow(workspacePath, label))
    this.createQueue = run.then(() => undefined, () => undefined)
    return run
  }

  private async createNow(workspacePath: string, label: string): Promise<WorktreeLaneHandle> {
    await this.sweepOnce(workspacePath)

    // 排除必须在洁净度检查之前：应用自己往 `.adnify/` 里写 plan 文档和 agent 临时
    // 文件，仓库没把它加进 .gitignore 时这些未跟踪文件会让检查永远失败 —— 而本该
    // 让检查通过的那条 exclude 却排在检查后面，于是每次重试都同样失败。
    await this.ensureExcluded(workspacePath)

    if (!await gitService.isWorkingTreeClean(workspacePath)) {
      throw new LaneUnavailableError(
        'Cannot start an isolated parallel writer while the base workspace has uncommitted changes.',
        notice('dirtyBase'),
      )
    }
    const id = crypto.randomUUID().slice(0, 8)
    const segment = laneSegment(label)
    const path = `${this.laneRoot(workspacePath)}/${segment}-${id}`
    const branch = `${WORKTREE_LANE_BRANCH_PREFIX}${segment}-${id}`
    const baseBranch = await gitService.getCurrentBranch(workspacePath) || undefined
    const baseCommit = await gitService.resolveCommit('HEAD', workspacePath) || undefined

    const result = await gitService.createWorktree(path, branch, workspacePath)
    if (!result.success) throw new LaneUnavailableError(result.error || 'Unable to create worktree lane', notice('createFailed'))

    const handle: WorktreeLaneHandle = { id, workspacePath, path, branch, baseBranch, baseCommit }
    this.activeLanes.set(this.laneKey(path), handle)
    logger.agent.info(`[WorktreeLane] Created ${branch} at ${path}`)
    return handle
  }

  private laneRoot(workspacePath: string): string {
    return `${normalizePath(workspacePath).replace(/\/$/, '')}/${WORKTREE_LANE_DIR}`
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
    const internalDir = `${normalizePath(workspacePath).replace(/\/$/, '')}/${ADNIFY_INTERNAL_DIR}`
    try {
      await gitExcludeService.update(workspacePath, internalDir, true, 'add', 'exclude')
    } catch (error) {
      logger.agent.warn(`[WorktreeLane] Unable to exclude ${ADNIFY_INTERNAL_DIR}: ${errorMessage(error)}`)
    }
  }

  async complete(handle: WorktreeLaneHandle, message: string): Promise<WorktreeLaneCompletion> {
    const commit = await gitService.commitWorktree(message, handle.path)
    if (!commit.success) {
      this.activeLanes.delete(this.laneKey(handle.path))
      // 目录和分支都留着：改动还没进提交，删掉就找不回来了。sweep 会因为工作树
      // 是脏的而跳过它，所以这份残留只能由用户处理 —— 日志里给出绝对路径。
      logger.agent.error(
        `[WorktreeLane] Lane ${handle.branch} could not be committed; leaving ${handle.path} on disk with uncommitted work: ${commit.error}`,
      )
      return { ...handle, success: false, outcome: 'failed', archived: false, notice: notice('commitFailed'), error: commit.error }
    }

    // 车道里一行都没改：没有值得保留的提交，目录和分支一起收掉。
    if (commit.committed === false && !await this.hasOwnCommits(handle)) {
      const dropped = await this.drop(handle)
      // 清理失败时不能说成功：目录或分支还在仓库里，用户需要知道。
      return {
        ...handle,
        success: !dropped,
        outcome: dropped ? 'failed' : 'discarded',
        commit: commit.commit,
        notice: dropped ? notice('cleanupFailed', { branch: handle.branch }) : notice('emptyDiscarded', { branch: handle.branch }),
        error: dropped,
      }
    }

    return await new Promise<WorktreeLaneCompletion>(resolve => {
      this.mergeQueue = this.mergeQueue.then(async () => {
        resolve(await this.mergeNow(handle, commit.commit))
      }).catch(async error => {
        // archive 自己不抛（gitService 都返回结果对象），但万一抛了，resolve 就永远
        // 不会被调用，complete() 挂死且没有超时 —— 所以兜一层。
        let archived = false
        try {
          archived = await this.archive(handle)
        } catch (archiveError) {
          logger.agent.warn(`[WorktreeLane] Archive failed while handling a merge-queue error: ${errorMessage(archiveError)}`)
        }
        resolve({
          ...handle,
          success: false,
          outcome: 'failed',
          commit: commit.commit,
          archived,
          notice: notice('mergeFailed'),
          error: errorMessage(error),
        })
      })
    })
  }

  /** 串行合并队列里的实际动作：校验基准 → 合并 → 回收目录与分支 */
  private async mergeNow(handle: WorktreeLaneHandle, commit?: string): Promise<WorktreeLaneCompletion> {
    // 归档保留：目录回收、分支留着。原因码交给渲染层翻译，`error` 只留 Git 原文。
    const retain = async (
      reason: ExecutionLaneNotice,
      options?: { conflicts?: string[]; error?: string },
    ): Promise<WorktreeLaneCompletion> => {
      const archived = await this.archive(handle)
      return {
        ...handle,
        success: false,
        outcome: 'retained',
        commit,
        conflicts: options?.conflicts,
        archived,
        notice: reason,
        error: options?.error,
      }
    }

    if (!await gitService.isWorkingTreeClean(handle.workspacePath)) {
      return await retain(notice('dirtyBaseMerge'))
    }

    // 基准分支被切走以后合并会把车道提交落到别的分支上，宁可保留。
    const currentBranch = await gitService.getCurrentBranch(handle.workspacePath) || undefined
    if (handle.baseBranch && currentBranch !== handle.baseBranch) {
      return await retain(notice('baseBranchChanged', { current: currentBranch || 'detached HEAD', base: handle.baseBranch }))
    }

    const merged = await gitService.mergeWorktreeBranch(handle.branch, handle.workspacePath)
    if (!merged.success) {
      const conflicts = merged.conflicts?.length ? merged.conflicts : undefined
      return await retain(
        conflicts ? notice('conflicts', { files: conflicts.join(', ') }) : notice('mergeFailed'),
        { conflicts, error: merged.error },
      )
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

    // 提交失败（index.lock 被占、文件被杀软锁住、磁盘满）意味着改动还只存在于工作
    // 目录里。这时绝不能走 archive —— 它在 remove 被拒后会 --force，连带把这些没
    // 提交的改动一起删掉，而返回的却是"已保留到分支上"。目录原样留着，让用户能自己
    // 捞回来；分支也留着，sweep 会因为工作树是脏的而跳过它。
    if (!commit.success) {
      this.activeLanes.delete(this.laneKey(handle.path))
      logger.agent.error(
        `[WorktreeLane] Lane ${handle.branch} could not be committed (${reason}); leaving ${handle.path} on disk with uncommitted work: ${commit.error}`,
      )
      return {
        ...handle,
        success: false,
        outcome: 'failed',
        archived: false,
        notice: notice('commitFailed'),
        error: commit.error,
      }
    }

    const hasWork = commit.committed !== false || await this.hasOwnCommits(handle)

    if (!hasWork) {
      const dropped = await this.drop(handle)
      logger.agent.info(`[WorktreeLane] Discarded empty lane ${handle.branch} (${reason})`)
      return {
        ...handle,
        success: !dropped,
        outcome: dropped ? 'failed' : 'discarded',
        commit: commit.commit,
        notice: dropped ? notice('cleanupFailed', { branch: handle.branch }) : notice('emptyDiscarded', { branch: handle.branch }),
        error: dropped,
      }
    }

    const archived = await this.archive(handle)
    logger.agent.info(`[WorktreeLane] Archived lane ${handle.branch} (${reason})`)
    return {
      ...handle,
      success: false,
      outcome: 'retained',
      commit: commit.commit,
      archived,
      notice: notice('keptForRecovery', { branch: handle.branch }),
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
    let removed = await gitService.removeWorktree(handle.path, handle.workspacePath)
    if (!removed.success) removed = await gitService.removeWorktree(handle.path, handle.workspacePath, true)
    if (!removed.success) {
      // 注销要放在成功之后：删不掉的目录仍然是一个已登记的 worktree，如果这里先把
      // 它从 activeLanes 里摘掉，sweep 既不认它是本会话的车道、又因为它是脏的而不
      // 回收，于是永远没人管。留在表里至少能让 sweep 继续跳过它。
      logger.agent.warn(`[WorktreeLane] Unable to remove worktree ${handle.path}: ${removed.error}`)
      return false
    }
    this.activeLanes.delete(this.laneKey(handle.path))
    // remove 之后必须 prune：否则 .git/worktrees 里的残留登记会让同名车道再也建不起来。
    await gitService.pruneWorktrees(handle.workspacePath)
    return true
  }

  /**
   * 目录和分支一起删掉；返回错误信息（成功则 undefined）。
   *
   * 用 `branch -d`（非强制）而不是 `-D`：`drop` 只在车道相对基点没有任何自己的提交
   * 时才会被调用，这种分支对 Git 来说已经是"完全合并"的，`-d` 足够删掉它。而 `-D`
   * 命中 DANGEROUS_GIT_PATTERNS（`branch … -D`），会走审批通道弹一次模态框 —— 后台
   * 并行跑 6 个空车道就是 6 次弹框，用户完全不知道自己在批准什么；被拒绝时错误还会
   * 被塞进一个 success:true 的结果里，于是分支留下来、提示却说已经删掉了。
   */
  private async drop(handle: WorktreeLaneHandle): Promise<string | undefined> {
    const archived = await this.archive(handle)
    if (!archived) return `Unable to remove worktree ${handle.path}`
    const deleted = await gitService.deleteBranch(handle.branch, false, handle.workspacePath)
    if (!deleted.success) {
      logger.agent.warn(`[WorktreeLane] Unable to delete lane branch ${handle.branch}: ${deleted.error}`)
      return deleted.error
    }
    return undefined
  }

  /**
   * 重试合并一条归档车道（任务面板的「恢复」动作）。
   *
   * 走同一条串行合并队列，所以不会和正在结束的车道抢基准工作区。
   */
  async retryMerge(workspacePath: string, branch: string): Promise<LaneActionResult> {
    if (!branch.startsWith(WORKTREE_LANE_BRANCH_PREFIX)) {
      return { success: false, notice: notice('notLaneBranch', { branch }) }
    }

    return await new Promise(resolve => {
      this.mergeQueue = this.mergeQueue.then(async () => {
        if (!await gitService.isWorkingTreeClean(workspacePath)) {
          resolve({ success: false, notice: notice('dirtyBaseMerge') })
          return
        }
        const merged = await gitService.mergeWorktreeBranch(branch, workspacePath)
        if (!merged.success) {
          const conflicts = merged.conflicts?.length ? merged.conflicts : undefined
          resolve({
            success: false,
            conflicts,
            notice: conflicts ? notice('conflicts', { files: conflicts.join(', ') }) : notice('mergeFailed'),
            error: merged.error,
          })
          return
        }
        const deleted = await gitService.deleteBranch(branch, false, workspacePath)
        if (!deleted.success) logger.agent.warn(`[WorktreeLane] Merged ${branch}, but branch cleanup failed: ${deleted.error}`)
        resolve({ success: true })
      }).catch(error => resolve({ success: false, notice: notice('mergeFailed'), error: errorMessage(error) }))
    })
  }

  /**
   * 彻底丢弃一条车道：目录 + 分支都删掉，提交不可恢复。
   * 只应该由用户显式触发（恢复面板会先弹一次带分支名的确认框）。
   *
   * 分支删除走车道通道的 `deleteLaneBranch`：`branch -D` 命中全局危险模式会再弹一次
   * 安全审批，用户刚确认过一遍，连着第二个弹框只会让人以为出了别的事。
   */
  async dropLane(workspacePath: string, lane: { branch: string; path?: string }): Promise<LaneActionResult> {
    if (!lane.branch.startsWith(WORKTREE_LANE_BRANCH_PREFIX)) {
      return { success: false, notice: notice('notLaneBranch', { branch: lane.branch }) }
    }
    if (lane.path && this.activeLanes.has(this.laneKey(lane.path))) return { success: false, notice: notice('laneStillRunning') }

    if (lane.path) {
      let removed = await gitService.removeWorktree(lane.path, workspacePath)
      if (!removed.success) removed = await gitService.removeWorktree(lane.path, workspacePath, true)
      if (!removed.success) return { success: false, error: removed.error }
      await gitService.pruneWorktrees(workspacePath)
    }
    const deleted = await gitService.deleteLaneBranch(lane.branch, workspacePath)
    return deleted.success ? { success: true } : { success: false, error: deleted.error }
  }

  /**
   * 会话开始后第一次建车道时，回收上次会话崩溃留下的残留。
   *
   * 只动"干净"的车道目录：清掉目录、留下分支（提交还在，随时能捞回来）。
   * 有未提交改动的残留车道一律不碰 —— 那是别人没保存的工作，让它留在原地由用户决定，
   * 比我们替他删掉安全。留下来的分支会出现在 Git 面板的分支列表里（`adnify/lane-*`
   * 前缀），签出、合并、删除都走那条既有通道，这里不再另开一套残留车道清单。
   */
  private async sweepOnce(workspacePath: string): Promise<void> {
    const key = this.laneKey(workspacePath)
    if (this.sweptWorkspaces.has(key)) return
    this.sweptWorkspaces.add(key)
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
      if (!pathStartsWith(entry.path, laneRoot) || pathEquals(entry.path, laneRoot)) continue
      if (this.activeLanes.has(this.laneKey(entry.path))) continue
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
