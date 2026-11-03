/**
 * 车道 Git 命令的形状与解析。
 *
 * 这些 argv 是主进程 worktreeLanePolicy 唯一放过的形状，改动会被那条通道直接拒绝
 * （而且是静默失败：车道建不起来，用户只看到"无法创建车道"）。所以把它们钉住。
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const worktreeLane = vi.hoisted(() => vi.fn())
const execSecure = vi.hoisted(() => vi.fn())

vi.mock('@/renderer/services/electronAPI', () => ({
  api: { git: { worktreeLane, execSecure } },
}))
vi.mock('@/renderer/services/aiAttributionService', () => ({ aiAttributionService: {} }))

import { gitService } from '@/renderer/services/gitService'

const ok = (stdout = '') => ({ success: true, stdout, stderr: '', exitCode: 0 })

describe('gitService worktree lane commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    worktreeLane.mockResolvedValue(ok())
    execSecure.mockResolvedValue(ok())
  })

  it('creates a lane through the dedicated channel, not the approval-gated one', async () => {
    const result = await gitService.createWorktree('D:/repo/.adnify/worktrees/task-1', 'adnify/lane-task-1', 'D:/repo')
    expect(worktreeLane).toHaveBeenCalledWith(
      ['worktree', 'add', '-b', 'adnify/lane-task-1', 'D:/repo/.adnify/worktrees/task-1', 'HEAD'],
      'D:/repo',
    )
    expect(execSecure).not.toHaveBeenCalled()
    expect(result).toMatchObject({ success: true })
  })

  it('creates from the recorded commit even if the base HEAD has since advanced', async () => {
    const baseCommit = '1111111111111111111111111111111111111111'
    await gitService.createWorktree('D:/repo/.adnify/worktrees/task-1', 'adnify/lane-task-1', 'D:/repo', baseCommit)
    expect(worktreeLane).toHaveBeenCalledWith(
      ['worktree', 'add', '-b', 'adnify/lane-task-1', 'D:/repo/.adnify/worktrees/task-1', baseCommit],
      'D:/repo',
    )
  })

  it.each([
    { force: false, expected: ['worktree', 'remove', 'D:/repo/.adnify/worktrees/task-1'] },
    { force: true, expected: ['worktree', 'remove', '--force', 'D:/repo/.adnify/worktrees/task-1'] },
  ])('removes a lane (force=$force) through the dedicated channel', async ({ force, expected }) => {
    await gitService.removeWorktree('D:/repo/.adnify/worktrees/task-1', 'D:/repo', force)
    expect(worktreeLane).toHaveBeenCalledWith(expected, 'D:/repo')
  })

  it('prunes and lists through the dedicated channel', async () => {
    await gitService.pruneWorktrees('D:/repo')
    await gitService.listWorktrees('D:/repo')
    expect(worktreeLane).toHaveBeenNthCalledWith(1, ['worktree', 'prune'], 'D:/repo')
    expect(worktreeLane).toHaveBeenNthCalledWith(2, ['worktree', 'list', '--porcelain'], 'D:/repo')
  })

  it('surfaces a refusal from the lane channel as a failed result', async () => {
    worktreeLane.mockResolvedValue({ success: false, error: '车道目录必须位于工作区的 .adnify/worktrees 之内' })
    const result = await gitService.createWorktree('D:/elsewhere', 'adnify/lane-x', 'D:/repo')
    expect(result).toMatchObject({ success: false })
    expect(result.error).toContain('.adnify/worktrees')
  })

  it('parses the porcelain worktree list, including detached entries', async () => {
    worktreeLane.mockResolvedValue(ok([
      'worktree D:/repo',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree D:/repo/.adnify/worktrees/task-1',
      'HEAD 2222222222222222222222222222222222222222',
      'branch refs/heads/adnify/lane-task-1',
      '',
      'worktree D:/repo/.adnify/worktrees/task-2',
      'HEAD 3333333333333333333333333333333333333333',
      'detached',
      '',
    ].join('\n')))

    await expect(gitService.listWorktrees('D:/repo')).resolves.toEqual([
      { path: 'D:/repo', head: '1111111111111111111111111111111111111111', branch: 'main' },
      { path: 'D:/repo/.adnify/worktrees/task-1', head: '2222222222222222222222222222222222222222', branch: 'adnify/lane-task-1' },
      { path: 'D:/repo/.adnify/worktrees/task-2', head: '3333333333333333333333333333333333333333', branch: undefined },
    ])
  })

  it('returns an empty list when the channel refuses instead of throwing', async () => {
    worktreeLane.mockResolvedValue({ success: false, error: 'denied' })
    await expect(gitService.listWorktrees('D:/repo')).resolves.toEqual([])
  })

  it('reports whether the lane commit actually advanced HEAD', async () => {
    execSecure
      .mockResolvedValueOnce(ok())                       // add -A
      .mockResolvedValueOnce(ok())                       // diff --cached --quiet -> nothing staged
      .mockResolvedValueOnce(ok('abc1234\n'))            // rev-parse HEAD
    await expect(gitService.commitWorktree('msg', 'D:/repo/.adnify/worktrees/task-1'))
      .resolves.toEqual({ success: true, commit: 'abc1234', committed: false })

    execSecure.mockReset()
    execSecure
      .mockResolvedValueOnce(ok())                                        // add -A
      .mockResolvedValueOnce({ success: false, exitCode: 1, stdout: '' }) // diff --cached --quiet -> staged changes
      .mockResolvedValueOnce(ok())                                       // commit
      .mockResolvedValueOnce(ok('def5678\n'))                            // rev-parse HEAD
    await expect(gitService.commitWorktree('msg', 'D:/repo/.adnify/worktrees/task-1'))
      .resolves.toEqual({ success: true, commit: 'def5678', committed: true })
  })

  it('leaves a pre-existing merge alone', async () => {
    execSecure.mockResolvedValueOnce(ok('pending'))
    expect((await gitService.mergeWorktreeBranch('adnify/lane-task-1', 'D:/repo')).success).toBe(false)
    expect(execSecure).toHaveBeenCalledTimes(1)
  })

  it('aborts a conflicting merge and reports the conflicting files', async () => {
    execSecure
      .mockResolvedValueOnce({ success: false, exitCode: 1 })
      .mockResolvedValueOnce({ success: false, exitCode: 1, stdout: '', stderr: 'CONFLICT (content)' }) // merge
      .mockResolvedValueOnce(ok('src/a.ts\0src/c.ts\0'))                             // diff --name-only --diff-filter=U -z
      .mockResolvedValueOnce(ok('merge-head'))
      .mockResolvedValueOnce(ok())                                                                      // merge --abort

    const result = await gitService.mergeWorktreeBranch('adnify/lane-task-1', 'D:/repo')
    expect(result).toMatchObject({ success: false, conflicts: ['src/a.ts', 'src/c.ts'] })
    expect(execSecure).toHaveBeenLastCalledWith(
      ['--no-optional-locks', '-c', 'core.quotePath=false', 'merge', '--abort'],
      'D:/repo',
    )
  })
})

describe('lane integration with a real Git index', () => {
  it('preserves dirty user files and creates a two-parent commit after text resolution', async () => {
    const root = mkdtempSync(join(tmpdir(), 'adnify-lane-test-'))
    function run(args: string[]) {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
      return { success: result.status === 0, exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr }
    }
    function git(...args: string[]) {
      const result = run(args)
      if (!result.success) throw new Error(result.stderr)
      return result.stdout.trim()
    }
    const file = 'src [1].txt'
    const write = (path: string, value: string) => writeFileSync(join(root, path), value + '\n')
    try {
      execSecure.mockImplementation((args: string[]) => run(args))
      git('init', '-b', 'base')
      git('config', 'user.name', 'Lane Test')
      git('config', 'user.email', 'lane@example.invalid')
      git('config', 'commit.gpgsign', 'false')
      write(file, 'original')
      write('notes', 'original')
      git('add', '.')
      git('commit', '-m', 'base')
      git('checkout', '-b', 'lane')
      write(file, 'first lane')
      git('commit', '-am', 'first work')
      git('checkout', 'base')
      write(file, 'local overlapping edit')
      expect((await gitService.fastForwardLane('lane', root)).success).toBe(false)
      expect(readFileSync(join(root, file), 'utf8')).toContain('local overlapping edit')
      git('restore', '--', file)
      write('notes', 'my unrelated edit')
      expect((await gitService.fastForwardLane('lane', root)).success).toBe(true)
      expect(readFileSync(join(root, 'notes'), 'utf8')).toContain('my unrelated edit')
      git('restore', '--', 'notes')
      git('checkout', 'lane')
      write(file, 'lane edit')
      git('commit', '-am', 'lane edit')
      git('checkout', 'base')
      write(file, 'base edit')
      git('commit', '-am', 'base edit')
      const merge = await gitService.mergeKeepConflicts('lane', root)
      expect(merge.conflicts).toEqual([file])
      expect((await gitService.commitResolvedMerge([file], 'unresolved', root)).success).toBe(false)
      write(file, 'base edit') // No cached diff against HEAD, but still requires a merge commit.
      expect((await gitService.commitResolvedMerge([file], 'resolved', root)).success).toBe(true)
      expect(git('rev-list', '--parents', '-n', '1', 'HEAD').split(' ')).toHaveLength(3)
    } finally {
      if (dirname(resolve(root)) === resolve(tmpdir())) rmSync(root, { recursive: true, force: true })
    }
  }, 30000)
})
