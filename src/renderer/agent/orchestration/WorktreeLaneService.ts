import { gitService } from '@/renderer/services/gitService'
import { logger } from '@utils/Logger'
import { gitExcludeService } from '@/renderer/services/gitExcludeService'

export interface WorktreeLaneHandle {
  id: string
  workspacePath: string
  path: string
  branch: string
  baseBranch?: string
}

export interface WorktreeLaneCompletion extends WorktreeLaneHandle {
  success: boolean
  commit?: string
  merged?: boolean
  conflicts?: string[]
  error?: string
}

const safeSegment = (value: string) => value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'task'

class WorktreeLaneServiceClass {
  private createQueue: Promise<unknown> = Promise.resolve()
  private mergeQueue: Promise<unknown> = Promise.resolve()

  async create(workspacePath: string, label: string): Promise<WorktreeLaneHandle> {
    const run = this.createQueue.then(() => this.createNow(workspacePath, label))
    this.createQueue = run.then(() => undefined, () => undefined)
    return run
  }

  private async createNow(workspacePath: string, label: string): Promise<WorktreeLaneHandle> {
    if (!await gitService.isWorkingTreeClean(workspacePath)) {
      throw new Error('Cannot start an isolated parallel writer while the base workspace has uncommitted changes. Commit or stash them, or run the task exclusively.')
    }
    const id = crypto.randomUUID().slice(0, 8)
    const normalized = workspacePath.replace(/\\/g, '/').replace(/\/$/, '')
    const laneRoot = `${normalized}/.adnify/worktrees`
    const path = `${laneRoot}/${safeSegment(label)}-${id}`
    const branch = `adnify/lane-${safeSegment(label)}-${id}`
    const baseBranch = await gitService.getCurrentBranch(workspacePath) || undefined
    await gitExcludeService.update(workspacePath, laneRoot, true, 'add', 'exclude')
    const result = await gitService.createWorktree(path, branch, workspacePath)
    if (!result.success) throw new Error(result.error || 'Unable to create worktree lane')
    logger.agent.info(`[WorktreeLane] Created ${branch} at ${path}`)
    return { id, workspacePath, path, branch, baseBranch }
  }

  async complete(handle: WorktreeLaneHandle, message: string): Promise<WorktreeLaneCompletion> {
    const commit = await gitService.commitWorktree(message, handle.path)
    if (!commit.success) return { ...handle, success: false, error: commit.error }

    return await new Promise(resolve => {
      this.mergeQueue = this.mergeQueue.then(async () => {
        if (!await gitService.isWorkingTreeClean(handle.workspacePath)) {
          resolve({ ...handle, success: false, commit: commit.commit, error: `Lane ${handle.branch} is ready at ${handle.path}, but the base workspace has uncommitted changes. Finish the active writer, then merge this lane.` })
          return
        }
        const merged = await gitService.mergeWorktreeBranch(handle.branch, handle.workspacePath)
        if (!merged.success) {
          resolve({ ...handle, success: false, commit: commit.commit, conflicts: merged.conflicts, error: merged.error })
          return
        }
        const removed = await gitService.removeWorktree(handle.path, handle.workspacePath)
        if (!removed.success) logger.agent.warn(`[WorktreeLane] Merged ${handle.branch}, but cleanup failed: ${removed.error}`)
        else await gitService.deleteBranch(handle.branch, false, handle.workspacePath)
        resolve({ ...handle, success: true, commit: commit.commit, merged: true })
      }).catch(error => resolve({ ...handle, success: false, error: error instanceof Error ? error.message : String(error) }))
    })
  }
}

export const WorktreeLaneService = new WorktreeLaneServiceClass()
