import { beforeEach, describe, expect, it, vi } from 'vitest'

const git = vi.hoisted(() => ({
  isWorkingTreeClean: vi.fn(),
  getCurrentBranch: vi.fn(),
  createWorktree: vi.fn(),
  commitWorktree: vi.fn(),
  mergeWorktreeBranch: vi.fn(),
  removeWorktree: vi.fn(),
  deleteBranch: vi.fn(),
}))
const exclude = vi.hoisted(() => ({ update: vi.fn() }))

vi.mock('@/renderer/services/gitService', () => ({ gitService: git }))
vi.mock('@/renderer/services/gitExcludeService', () => ({ gitExcludeService: exclude }))

import { WorktreeLaneService } from '@/renderer/agent/orchestration/WorktreeLaneService'

describe('WorktreeLaneService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    git.isWorkingTreeClean.mockResolvedValue(true)
    git.getCurrentBranch.mockResolvedValue('main')
    git.createWorktree.mockResolvedValue({ success: true })
    git.commitWorktree.mockResolvedValue({ success: true, commit: 'abc' })
    git.mergeWorktreeBranch.mockResolvedValue({ success: true })
    git.removeWorktree.mockResolvedValue({ success: true })
    git.deleteBranch.mockResolvedValue({ success: true })
    exclude.update.mockResolvedValue({ changed: true, pattern: '/.adnify/worktrees/', target: 'exclude' })
  })

  it('blocks isolation from a dirty base snapshot', async () => {
    git.isWorkingTreeClean.mockResolvedValue(false)
    await expect(WorktreeLaneService.create('D:/repo', 'write task')).rejects.toThrow('uncommitted changes')
    expect(git.createWorktree).not.toHaveBeenCalled()
  })

  it('commits, serially merges, and removes a successful lane', async () => {
    const lane = await WorktreeLaneService.create('D:/repo', 'write task')
    const result = await WorktreeLaneService.complete(lane, 'done')
    expect(result).toMatchObject({ success: true, merged: true, commit: 'abc' })
    expect(git.mergeWorktreeBranch).toHaveBeenCalledWith(lane.branch, 'D:/repo')
    expect(git.removeWorktree).toHaveBeenCalledWith(lane.path, 'D:/repo')
  })

  it('retains a conflicting lane for recovery', async () => {
    git.mergeWorktreeBranch.mockResolvedValue({ success: false, conflicts: ['src/a.ts'], error: 'conflict' })
    const lane = await WorktreeLaneService.create('D:/repo', 'write task')
    const result = await WorktreeLaneService.complete(lane, 'done')
    expect(result).toMatchObject({ success: false, conflicts: ['src/a.ts'] })
    expect(git.removeWorktree).not.toHaveBeenCalled()
  })
})
