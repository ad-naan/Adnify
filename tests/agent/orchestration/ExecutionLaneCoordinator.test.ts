import { beforeEach, describe, expect, it, vi } from 'vitest'

const git = vi.hoisted(() => ({ getCurrentBranch: vi.fn() }))
const lanes = vi.hoisted(() => ({ create: vi.fn(), complete: vi.fn() }))
vi.mock('@/renderer/services/gitService', () => ({ gitService: git }))
vi.mock('@/renderer/agent/orchestration/WorktreeLaneService', () => ({ WorktreeLaneService: lanes }))

import { ExecutionLaneCoordinator } from '@/renderer/agent/orchestration/ExecutionLaneCoordinator'

describe('ExecutionLaneCoordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    git.getCurrentBranch.mockResolvedValue('main')
    lanes.create.mockResolvedValue({ id: 'lane', workspacePath: 'D:/repo', path: 'D:/repo/.adnify/worktrees/lane', branch: 'adnify/lane', baseBranch: 'main' })
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
    expect(result).toMatchObject({ isolated: true, workspacePath: 'D:/repo/.adnify/worktrees/lane' })
  })

  it('blocks concurrent writes outside Git instead of pretending to isolate', async () => {
    git.getCurrentBranch.mockResolvedValue(null)
    await expect(ExecutionLaneCoordinator.acquire({ kind: 'agent-session', workspacePath: 'D:/plain', label: 'task', mayWrite: true, concurrent: true }))
      .rejects.toThrow('requires a Git repository')
  })
})
