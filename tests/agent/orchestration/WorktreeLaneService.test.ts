import { beforeEach, describe, expect, it, vi } from 'vitest'

const git = vi.hoisted(() => ({
  isWorkingTreeClean: vi.fn(),
  getCurrentBranch: vi.fn(),
  resolveCommit: vi.fn(),
  countCommitsBetween: vi.fn(),
  createWorktree: vi.fn(),
  commitWorktree: vi.fn(),
  mergeWorktreeBranch: vi.fn(),
  removeWorktree: vi.fn(),
  pruneWorktrees: vi.fn(),
  listWorktrees: vi.fn(),
  deleteBranch: vi.fn(),
}))
const exclude = vi.hoisted(() => ({ update: vi.fn() }))

vi.mock('@/renderer/services/gitService', () => ({ gitService: git }))
vi.mock('@/renderer/services/gitExcludeService', () => ({ gitExcludeService: exclude }))

type LaneService = typeof import('@/renderer/agent/orchestration/WorktreeLaneService')['WorktreeLaneService']

describe('WorktreeLaneService', () => {
  // 单例带跨调用状态（已回收过的工作区、活跃车道），每个用例都要一份干净的模块实例
  let service: LaneService

  beforeEach(async () => {
    vi.clearAllMocks()
    git.isWorkingTreeClean.mockResolvedValue(true)
    git.getCurrentBranch.mockResolvedValue('main')
    git.resolveCommit.mockResolvedValue('base000')
    git.countCommitsBetween.mockResolvedValue(1)
    git.createWorktree.mockResolvedValue({ success: true })
    git.commitWorktree.mockResolvedValue({ success: true, commit: 'abc', committed: true })
    git.mergeWorktreeBranch.mockResolvedValue({ success: true })
    git.removeWorktree.mockResolvedValue({ success: true })
    git.pruneWorktrees.mockResolvedValue({ success: true })
    git.listWorktrees.mockResolvedValue([])
    git.deleteBranch.mockResolvedValue({ success: true })
    exclude.update.mockResolvedValue({ changed: true, pattern: '/.adnify/', target: 'exclude' })

    vi.resetModules()
    service = (await import('@/renderer/agent/orchestration/WorktreeLaneService')).WorktreeLaneService
  })

  it('blocks isolation from a dirty base snapshot', async () => {
    git.isWorkingTreeClean.mockResolvedValue(false)
    await expect(service.create('D:/repo', 'write task')).rejects.toThrow('uncommitted changes')
    expect(git.createWorktree).not.toHaveBeenCalled()
  })

  it('excludes the whole .adnify directory, not just the worktree root', async () => {
    // 只排除 .adnify/worktrees 时，应用自己写的 .adnify/plan/*.md 会让基准工作区
    // 永远是脏的，车道功能整体失效
    await service.create('D:/repo', 'write task')
    expect(exclude.update).toHaveBeenCalledWith('D:/repo', 'D:/repo/.adnify', true, 'add', 'exclude')
  })

  it('keeps non-ASCII labels recognizable in lane names', async () => {
    const lane = await service.create('D:/repo', '重构 渲染器 pipeline')
    expect(lane.branch).toMatch(/^adnify\/lane-重构-渲染器-pipeline-[0-9a-f]{8}$/)
    expect(lane.path).toContain('/.adnify/worktrees/重构-渲染器-pipeline-')
  })

  it('records the base commit so an empty lane can be recognized later', async () => {
    const lane = await service.create('D:/repo', 'write task')
    expect(lane).toMatchObject({ baseBranch: 'main', baseCommit: 'base000' })
  })

  it('commits, serially merges, then removes the worktree and the branch', async () => {
    const lane = await service.create('D:/repo', 'write task')
    const result = await service.complete(lane, 'done')
    expect(result).toMatchObject({ success: true, outcome: 'merged', merged: true, commit: 'abc', archived: true })
    expect(git.mergeWorktreeBranch).toHaveBeenCalledWith(lane.branch, 'D:/repo')
    expect(git.removeWorktree).toHaveBeenCalledWith(lane.path, 'D:/repo')
    expect(git.pruneWorktrees).toHaveBeenCalledWith('D:/repo')
    expect(git.deleteBranch).toHaveBeenCalledWith(lane.branch, false, 'D:/repo')
  })

  it('archives a conflicting lane: folder reclaimed, branch kept', async () => {
    git.mergeWorktreeBranch.mockResolvedValue({ success: false, conflicts: ['src/a.ts'], error: 'conflict' })
    const lane = await service.create('D:/repo', 'write task')
    const result = await service.complete(lane, 'done')
    expect(result).toMatchObject({ success: false, outcome: 'retained', archived: true, conflicts: ['src/a.ts'] })
    expect(git.removeWorktree).toHaveBeenCalledWith(lane.path, 'D:/repo')
    expect(git.deleteBranch).not.toHaveBeenCalled()
  })

  it('refuses to merge onto a different branch than the lane base', async () => {
    const lane = await service.create('D:/repo', 'write task')
    git.getCurrentBranch.mockResolvedValue('release/1.0')
    const result = await service.complete(lane, 'done')
    expect(git.mergeWorktreeBranch).not.toHaveBeenCalled()
    expect(result).toMatchObject({ success: false, outcome: 'retained', archived: true })
    // 分支名现在走原因码的参数，而不是 service 拼出来的英文句子
    expect(result.notice).toEqual({ code: 'baseBranchChanged', params: { current: 'release/1.0', base: 'main' } })
  })

  it('retains the lane when the base workspace turned dirty while it ran', async () => {
    const lane = await service.create('D:/repo', 'write task')
    git.isWorkingTreeClean.mockResolvedValue(false)
    const result = await service.complete(lane, 'done')
    expect(git.mergeWorktreeBranch).not.toHaveBeenCalled()
    expect(result).toMatchObject({ success: false, outcome: 'retained' })
  })

  it('drops a lane that produced nothing instead of leaving a branch behind', async () => {
    git.commitWorktree.mockResolvedValue({ success: true, commit: 'base000', committed: false })
    git.countCommitsBetween.mockResolvedValue(0)
    const lane = await service.create('D:/repo', 'write task')
    const result = await service.complete(lane, 'done')
    expect(result).toMatchObject({ success: true, outcome: 'discarded' })
    expect(git.mergeWorktreeBranch).not.toHaveBeenCalled()
    expect(git.removeWorktree).toHaveBeenCalledWith(lane.path, 'D:/repo')
    // -d 而不是 -D：空车道的分支相对基点没有自己的提交，普通删除就够；`-D` 命中
    // 危险模式会给后台清理弹一次审批框。
    expect(git.deleteBranch).toHaveBeenCalledWith(lane.branch, false, 'D:/repo')
  })

  it('merges a lane whose agent committed on its own even when nothing is left to stage', async () => {
    git.commitWorktree.mockResolvedValue({ success: true, commit: 'own111', committed: false })
    git.countCommitsBetween.mockResolvedValue(2)
    const lane = await service.create('D:/repo', 'write task')
    const result = await service.complete(lane, 'done')
    expect(result).toMatchObject({ success: true, outcome: 'merged' })
  })

  it('serializes merges so two lanes never touch the base workspace at once', async () => {
    const order: string[] = []
    let releaseFirst: () => void = () => undefined
    git.mergeWorktreeBranch.mockImplementation(async (branch: string) => {
      order.push(`start:${branch}`)
      if (order.length === 1) await new Promise<void>(resolve => { releaseFirst = resolve })
      order.push(`end:${branch}`)
      return { success: true }
    })

    const first = await service.create('D:/repo', 'first')
    const second = await service.create('D:/repo', 'second')
    const firstCompletion = service.complete(first, 'done')
    const secondCompletion = service.complete(second, 'done')
    await new Promise(resolve => setTimeout(resolve, 0))
    releaseFirst()
    await Promise.all([firstCompletion, secondCompletion])

    expect(order).toEqual([
      `start:${first.branch}`, `end:${first.branch}`,
      `start:${second.branch}`, `end:${second.branch}`,
    ])
  })

  describe('discard', () => {
    it('commits work in progress and archives the lane', async () => {
      const lane = await service.create('D:/repo', 'write task')
      const result = await service.discard(lane, 'aborted by user')
      expect(git.commitWorktree).toHaveBeenCalledWith('Adnify lane WIP (aborted by user)', lane.path)
      expect(result).toMatchObject({ success: false, outcome: 'retained', archived: true })
      expect(git.removeWorktree).toHaveBeenCalledWith(lane.path, 'D:/repo')
      expect(git.deleteBranch).not.toHaveBeenCalled()
      expect(git.mergeWorktreeBranch).not.toHaveBeenCalled()
    })

    it('removes an empty lane entirely', async () => {
      git.commitWorktree.mockResolvedValue({ success: true, commit: 'base000', committed: false })
      git.countCommitsBetween.mockResolvedValue(0)
      const lane = await service.create('D:/repo', 'write task')
      const result = await service.discard(lane, 'timed out')
      expect(result).toMatchObject({ success: true, outcome: 'discarded' })
      expect(git.deleteBranch).toHaveBeenCalledWith(lane.branch, false, 'D:/repo')
    })

    it('never force-deletes work when the WIP commit fails', async () => {
      // add -A / commit 失败意味着改动只在工作目录里。这时 archive 的 --force 重试
      // 会连未提交的改动一起删掉，而旧代码返回的却是"已保留到分支上"。
      git.commitWorktree.mockResolvedValue({ success: false, error: 'fatal: Unable to create index.lock' })
      const lane = await service.create('D:/repo', 'write task')
      const result = await service.discard(lane, 'timed out')

      expect(git.removeWorktree).not.toHaveBeenCalled()
      expect(git.deleteBranch).not.toHaveBeenCalled()
      expect(result).toMatchObject({ success: false, outcome: 'failed', archived: false })
      expect(result.notice?.code).toBe('commitFailed')
    })

    it('reports a failed cleanup instead of calling it discarded', async () => {
      git.commitWorktree.mockResolvedValue({ success: true, commit: 'base000', committed: false })
      git.countCommitsBetween.mockResolvedValue(0)
      git.removeWorktree.mockResolvedValue({ success: false, error: 'permission denied' })
      const lane = await service.create('D:/repo', 'write task')
      const result = await service.discard(lane, 'timed out')

      expect(result.success).toBe(false)
      expect(result.outcome).toBe('failed')
      expect(result.notice?.code).toBe('cleanupFailed')
      expect(result.error).toBeTruthy()
    })

    it('force-removes a worktree Git refuses to release, then prunes the registration', async () => {
      git.removeWorktree.mockResolvedValueOnce({ success: false, error: 'contains modified files' })
      const lane = await service.create('D:/repo', 'write task')
      const result = await service.discard(lane, 'failed')
      expect(git.removeWorktree).toHaveBeenLastCalledWith(lane.path, 'D:/repo', true)
      expect(git.pruneWorktrees).toHaveBeenCalledWith('D:/repo')
      expect(result.archived).toBe(true)
    })
  })

  describe('sweep', () => {
    it('reclaims clean leftovers from a crashed session and keeps their branches', async () => {
      git.listWorktrees.mockResolvedValue([
        { path: 'D:/repo', branch: 'main' },
        { path: 'D:/repo/.adnify/worktrees/stale-1234abcd', branch: 'adnify/lane-stale-1234abcd' },
      ])
      const result = await service.sweep('D:/repo')
      expect(result.archived).toEqual(['D:/repo/.adnify/worktrees/stale-1234abcd'])
      expect(git.removeWorktree).toHaveBeenCalledWith('D:/repo/.adnify/worktrees/stale-1234abcd', 'D:/repo')
      expect(git.deleteBranch).not.toHaveBeenCalled()
    })

    it('never touches a leftover lane that still holds uncommitted work', async () => {
      git.listWorktrees.mockResolvedValue([{ path: 'D:/repo/.adnify/worktrees/dirty-1234abcd', branch: 'adnify/lane-dirty-1234abcd' }])
      git.isWorkingTreeClean.mockImplementation(async (root: string) => root === 'D:/repo')
      const result = await service.sweep('D:/repo')
      expect(result).toEqual({ archived: [], kept: ['D:/repo/.adnify/worktrees/dirty-1234abcd'] })
      expect(git.removeWorktree).not.toHaveBeenCalled()
    })

    it('leaves worktrees outside the lane root alone', async () => {
      git.listWorktrees.mockResolvedValue([{ path: 'D:/repo/../feature-checkout', branch: 'feature' }])
      const result = await service.sweep('D:/repo')
      expect(result).toEqual({ archived: [], kept: [] })
      expect(git.removeWorktree).not.toHaveBeenCalled()
    })

    it('runs at most once per workspace, and skips lanes this session owns', async () => {
      const lane = await service.create('D:/repo', 'write task')
      git.listWorktrees.mockResolvedValue([{ path: lane.path, branch: lane.branch }])
      await service.create('D:/repo', 'another task')
      expect(git.listWorktrees).toHaveBeenCalledTimes(1)

      const result = await service.sweep('D:/repo')
      expect(result).toEqual({ archived: [], kept: [] })
      expect(git.removeWorktree).not.toHaveBeenCalled()
    })

    // 这一组钉住 Windows：`git worktree list` 报的大小写来自 worktree add 时记下的
    // 路径，工作区路径来自用户的文件夹选择 / 最近项目，两者经常只差大小写。
    it('recognizes a lane root that differs only in case', async () => {
      git.listWorktrees.mockResolvedValue([
        { path: 'd:/repo/.adnify/worktrees/stale-1234abcd', branch: 'adnify/lane-stale-1234abcd' },
      ])
      const result = await service.sweep('D:/Repo')
      expect(result.archived).toEqual(['d:/repo/.adnify/worktrees/stale-1234abcd'])
    })

    it('still skips a live lane when Git reports its path in a different case', async () => {
      const lane = await service.create('D:/repo', 'write task')
      // 同一条车道，Git 用另一种大小写报出来 —— 绝不能当成残留删掉。
      git.listWorktrees.mockResolvedValue([{ path: lane.path.toUpperCase(), branch: lane.branch }])
      const result = await service.sweep('D:/repo')
      expect(result).toEqual({ archived: [], kept: [] })
      expect(git.removeWorktree).not.toHaveBeenCalled()
    })

    it('does not mistake the lane root itself for a lane', async () => {
      git.listWorktrees.mockResolvedValue([{ path: 'D:/repo/.adnify/worktrees', branch: 'main' }])
      const result = await service.sweep('D:/repo')
      expect(result).toEqual({ archived: [], kept: [] })
      expect(git.removeWorktree).not.toHaveBeenCalled()
    })
  })

  describe('recovery', () => {
    it('merges a retained branch through the same serialized queue', async () => {
      const result = await service.retryMerge('D:/repo', 'adnify/lane-archived-5678ef01')
      expect(result).toEqual({ success: true })
      expect(git.mergeWorktreeBranch).toHaveBeenCalledWith('adnify/lane-archived-5678ef01', 'D:/repo')
      expect(git.deleteBranch).toHaveBeenCalledWith('adnify/lane-archived-5678ef01', false, 'D:/repo')
    })

    it('refuses to merge or drop branches outside the lane namespace', async () => {
      await expect(service.retryMerge('D:/repo', 'main')).resolves.toMatchObject({ success: false })
      await expect(service.dropLane('D:/repo', { branch: 'main' })).resolves.toMatchObject({ success: false })
      expect(git.mergeWorktreeBranch).not.toHaveBeenCalled()
      expect(git.deleteBranch).not.toHaveBeenCalled()
    })

    it('refuses to drop a lane that is still running', async () => {
      const lane = await service.create('D:/repo', 'write task')
      await expect(service.dropLane('D:/repo', lane)).resolves.toMatchObject({ success: false, notice: { code: 'laneStillRunning' } })
      expect(git.removeWorktree).not.toHaveBeenCalled()
    })

    it('force-deletes the branch when the user drops an archived lane', async () => {
      const result = await service.dropLane('D:/repo', { branch: 'adnify/lane-archived-5678ef01' })
      expect(result).toEqual({ success: true })
      expect(git.deleteBranch).toHaveBeenCalledWith('adnify/lane-archived-5678ef01', true, 'D:/repo')
      expect(git.removeWorktree).not.toHaveBeenCalled()
    })
  })
})
