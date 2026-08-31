import { beforeEach, describe, expect, it, vi } from 'vitest'

const git = vi.hoisted(() => ({ isInsideWorkTree: vi.fn(), hasCommits: vi.fn() }))
const lanes = vi.hoisted(() => ({ create: vi.fn(), complete: vi.fn(), discard: vi.fn() }))
vi.mock('@/renderer/services/gitService', () => ({ gitService: git }))
vi.mock('@/renderer/agent/orchestration/WorktreeLaneService', () => ({ WorktreeLaneService: lanes }))

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

  it.each([
    { case: 'no repository', setup: () => git.isInsideWorkTree.mockResolvedValue(false), expected: 'requires a Git repository' },
    { case: 'dirty base', setup: () => lanes.create.mockRejectedValue(new Error('uncommitted changes')), expected: 'uncommitted changes' },
  ])('falls back to the shared workspace for agent sessions ($case)', async ({ setup, expected }) => {
    setup()
    const result = await ExecutionLaneCoordinator.acquire({
      kind: 'agent-session', workspacePath: 'D:/repo', label: 'chat', mayWrite: true, concurrent: true, allowSharedFallback: true,
    })
    expect(result).toMatchObject({ workspacePath: 'D:/repo', isolated: false })
    expect(result.fallbackReason).toContain(expected)
  })

  it('discards the lane when an execution node is released', async () => {
    const assignment = await ExecutionLaneCoordinator.acquire({ kind: 'sub-agent', workspacePath: 'D:/repo', label: 'task', mayWrite: true, concurrent: true })
    const released = await ExecutionLaneCoordinator.release(assignment, 'timed out')
    expect(lanes.discard).toHaveBeenCalledWith(lane, 'timed out')
    expect(released).toMatchObject({ outcome: 'retained' })
  })

  it('survives a failing release instead of masking the original error', async () => {
    lanes.discard.mockRejectedValue(new Error('worktree remove failed'))
    const assignment = await ExecutionLaneCoordinator.acquire({ kind: 'sub-agent', workspacePath: 'D:/repo', label: 'task', mayWrite: true, concurrent: true })
    await expect(ExecutionLaneCoordinator.release(assignment, 'failed')).resolves.toBeNull()
  })

  it('is a no-op when releasing a shared assignment', async () => {
    await expect(ExecutionLaneCoordinator.release({ workspacePath: 'D:/repo', isolated: false }, 'failed')).resolves.toBeNull()
    expect(lanes.discard).not.toHaveBeenCalled()
  })
})
