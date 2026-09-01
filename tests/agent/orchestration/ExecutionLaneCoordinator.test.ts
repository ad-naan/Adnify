import { beforeEach, describe, expect, it, vi } from 'vitest'

const git = vi.hoisted(() => ({ isInsideWorkTree: vi.fn(), hasCommits: vi.fn() }))
const lanes = vi.hoisted(() => ({ create: vi.fn(), complete: vi.fn(), discard: vi.fn() }))
// 车道服务被 mock 掉了，但协调器要用 LaneUnavailableError 判断"这次失败带没带原因码"，
// 所以桩里必须给出同名的类，否则 instanceof 会拿到 undefined。
const LaneUnavailableError = vi.hoisted(() => class LaneUnavailableError extends Error {
  constructor(message: string, readonly notice: { code: string }) {
    super(message)
    this.name = 'LaneUnavailableError'
  }
})
vi.mock('@/renderer/services/gitService', () => ({ gitService: git }))
vi.mock('@/renderer/agent/orchestration/WorktreeLaneService', () => ({ WorktreeLaneService: lanes, LaneUnavailableError }))

import { ExecutionLaneCoordinator } from '@/renderer/agent/orchestration/ExecutionLaneCoordinator'

const lane = { id: 'lane', workspacePath: 'D:/repo', path: 'D:/repo/.adnify/worktrees/lane', branch: 'adnify/lane-x', baseBranch: 'main' }

describe('ExecutionLaneCoordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    git.isInsideWorkTree.mockResolvedValue(true)
    git.hasCommits.mockResolvedValue(true)
    lanes.create.mockResolvedValue(lane)
    lanes.discard.mockResolvedValue({ ...lane, success: false, outcome: 'retained', archived: true })
  })

  it.each([
    { mayWrite: false, concurrent: true },
    { mayWrite: true, concurrent: false },
  ])('shares the workspace when isolation is unnecessary: %o', async ({ mayWrite, concurrent }) => {
    await expect(ExecutionLaneCoordinator.acquire({ kind: 'plan-task', workspacePath: 'D:/repo', label: 'task', mayWrite, concurrent }))
      .resolves.toEqual({ workspacePath: 'D:/repo', isolated: false })
    expect(lanes.create).not.toHaveBeenCalled()
  })

  it('isolates only concurrent writers', async () => {
    const result = await ExecutionLaneCoordinator.acquire({ kind: 'sub-agent', workspacePath: 'D:/repo', label: 'task', mayWrite: true, concurrent: true })
    expect(result).toMatchObject({ isolated: true, workspacePath: lane.path })
  })

  it('blocks concurrent writes outside Git instead of pretending to isolate', async () => {
    git.isInsideWorkTree.mockResolvedValue(false)
    await expect(ExecutionLaneCoordinator.acquire({ kind: 'sub-agent', workspacePath: 'D:/plain', label: 'task', mayWrite: true, concurrent: true }))
      .rejects.toThrow('requires a Git repository')
    expect(lanes.create).not.toHaveBeenCalled()
  })

  it('reports an empty repository separately from a missing one', async () => {
    git.hasCommits.mockResolvedValue(false)
    await expect(ExecutionLaneCoordinator.acquire({ kind: 'plan-task', workspacePath: 'D:/fresh', label: 'task', mayWrite: true, concurrent: true }))
      .rejects.toThrow('at least one commit')
  })

  it('isolates a detached HEAD checkout, which getCurrentBranch would have reported as "not a repository"', async () => {
    const result = await ExecutionLaneCoordinator.acquire({ kind: 'plan-task', workspacePath: 'D:/repo', label: 'task', mayWrite: true, concurrent: true })
    expect(result.isolated).toBe(true)
  })

  // 退回共享工作区时给出的是原因码而不是英文句子：渲染层才知道当前语言。
  it.each([
    { case: 'no repository', setup: () => git.isInsideWorkTree.mockResolvedValue(false), code: 'noRepository' },
    { case: 'no commits', setup: () => git.hasCommits.mockResolvedValue(false), code: 'noCommits' },
    {
      case: 'dirty base',
      setup: () => lanes.create.mockRejectedValue(new LaneUnavailableError('uncommitted changes', { code: 'dirtyBase' })),
      code: 'dirtyBase',
    },
    {
      case: 'an unclassified Git failure',
      setup: () => lanes.create.mockRejectedValue(new Error('fatal: something else')),
      code: 'createFailed',
    },
  ])('falls back to the shared workspace for agent sessions ($case)', async ({ setup, code }) => {
    setup()
    const result = await ExecutionLaneCoordinator.acquire({
      kind: 'agent-session', workspacePath: 'D:/repo', label: 'chat', mayWrite: true, concurrent: true, allowSharedFallback: true,
    })
    expect(result).toMatchObject({ workspacePath: 'D:/repo', isolated: false })
    expect(result.fallbackNotice).toEqual({ code })
  })

  it('carries the notice code on the hard-failure path too', async () => {
    git.isInsideWorkTree.mockResolvedValue(false)
    await expect(ExecutionLaneCoordinator.acquire({ kind: 'sub-agent', workspacePath: 'D:/plain', label: 'task', mayWrite: true, concurrent: true }))
      .rejects.toMatchObject({ notice: { code: 'noRepository' } })
  })

  it('discards the lane when an execution node is released', async () => {
    const assignment = await ExecutionLaneCoordinator.acquire({ kind: 'sub-agent', workspacePath: 'D:/repo', label: 'task', mayWrite: true, concurrent: true })
    const released = await ExecutionLaneCoordinator.release(assignment, 'timed out')
    expect(lanes.discard).toHaveBeenCalledWith(lane, 'timed out')
    expect(released).toMatchObject({ outcome: 'retained' })
  })

  it('surfaces a failing release instead of masking it as a no-op', async () => {
    lanes.discard.mockRejectedValue(new Error('worktree remove failed'))
    const assignment = await ExecutionLaneCoordinator.acquire({ kind: 'sub-agent', workspacePath: 'D:/repo', label: 'task', mayWrite: true, concurrent: true })
    // null 是"本来就没有车道"的返回值；归还失败必须给出可展示的 completion，
    // 否则仓库里留下的目录/分支没有任何一层会告诉用户。
    const released = await ExecutionLaneCoordinator.release(assignment, 'failed')
    expect(released).not.toBeNull()
    expect(released).toMatchObject({ success: false, outcome: 'failed' })
    expect(released?.notice?.code).toBe('cleanupFailed')
    expect(released?.error).toContain('worktree remove failed')
  })

  it('is a no-op when releasing a shared assignment', async () => {
    await expect(ExecutionLaneCoordinator.release({ workspacePath: 'D:/repo', isolated: false }, 'failed')).resolves.toBeNull()
    expect(lanes.discard).not.toHaveBeenCalled()
  })
})
