/**
 * 车道 Git 通道的准入矩阵。
 *
 * 这条通道是免审批的，所以"哪些命令被放过"必须是可测的：一旦形状放宽，
 * `git worktree add <任意路径>` 就能把一份完整检出写到工作区之外。
 */
import { describe, expect, it } from 'vitest'
import { assessWorktreeLaneCommand } from '../../../src/main/security/worktreeLanePolicy'

const ROOTS = ['/work/repo']
const CWD = '/work/repo'
const LANE = '/work/repo/.adnify/worktrees/task-1234abcd'
const BRANCH = 'adnify/lane-task-1234abcd'

const assess = (args: string[], cwd = CWD, roots = ROOTS) => assessWorktreeLaneCommand(args, cwd, roots)

describe('assessWorktreeLaneCommand', () => {
  describe('allows the exact lane shapes', () => {
    it.each([
      { name: 'add from HEAD', args: ['worktree', 'add', '-b', BRANCH, LANE, 'HEAD'] },
      { name: 'add from a commit hash', args: ['worktree', 'add', '-b', BRANCH, LANE, 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'] },
      { name: 'add from a short hash', args: ['worktree', 'add', '-b', BRANCH, LANE, 'a1b2c3d'] },
      { name: 'remove', args: ['worktree', 'remove', LANE] },
      { name: 'forced remove', args: ['worktree', 'remove', '--force', LANE] },
      { name: 'porcelain list', args: ['worktree', 'list', '--porcelain'] },
      { name: 'prune', args: ['worktree', 'prune'] },
    ])('$name', ({ args }) => {
      expect(assess(args).allowed).toBe(true)
    })

    it('accepts a cwd nested inside the workspace root', () => {
      expect(assess(['worktree', 'prune'], '/work/repo/src/renderer').allowed).toBe(true)
    })

    it('accepts a lane in any authorized root, not just the first', () => {
      const args = ['worktree', 'remove', '/work/other/.adnify/worktrees/task-1234abcd']
      expect(assess(args, '/work/other', ['/work/repo', '/work/other']).allowed).toBe(true)
    })

    it('accepts non-ASCII lane names', () => {
      const args = ['worktree', 'add', '-b', 'adnify/lane-重构-1234abcd', '/work/repo/.adnify/worktrees/重构-1234abcd', 'HEAD']
      expect(assess(args).allowed).toBe(true)
    })
  })

  describe('rejects everything else', () => {
    it.each([
      { name: 'no cwd', args: ['worktree', 'prune'], cwd: '', roots: ROOTS },
      { name: 'no authorized roots', args: ['worktree', 'prune'], cwd: CWD, roots: [] },
      { name: 'cwd outside the workspace', args: ['worktree', 'prune'], cwd: '/tmp/elsewhere', roots: ROOTS },
      { name: 'a different git command', args: ['status', '--porcelain'], cwd: CWD, roots: ROOTS },
      { name: 'an unsupported subcommand', args: ['worktree', 'move', LANE, '/tmp/x'], cwd: CWD, roots: ROOTS },
      { name: 'no subcommand', args: ['worktree'], cwd: CWD, roots: ROOTS },
      { name: 'an empty operand', args: ['worktree', 'remove', ''], cwd: CWD, roots: ROOTS },
    ])('rejects $name', ({ args, cwd, roots }) => {
      expect(assess(args, cwd, roots).allowed).toBe(false)
    })

    it.each([
      { name: 'a detached add', args: ['worktree', 'add', LANE] },
      { name: 'extra flags after the committish', args: ['worktree', 'add', '-b', BRANCH, LANE, 'HEAD', '--force'] },
      { name: 'a branch outside the lane namespace', args: ['worktree', 'add', '-b', 'feature/x', LANE, 'HEAD'] },
      { name: 'the bare lane prefix', args: ['worktree', 'add', '-b', 'adnify/lane-', LANE, 'HEAD'] },
      { name: 'a traversal sequence in the branch', args: ['worktree', 'add', '-b', 'adnify/lane-a..b', LANE, 'HEAD'] },
      { name: 'whitespace in the branch', args: ['worktree', 'add', '-b', 'adnify/lane-a b', LANE, 'HEAD'] },
      { name: 'a target outside the lane root', args: ['worktree', 'add', '-b', BRANCH, '/tmp/escape', 'HEAD'] },
      { name: 'a target that is the workspace root', args: ['worktree', 'add', '-b', BRANCH, '/work/repo', 'HEAD'] },
      { name: 'a sibling of the lane root', args: ['worktree', 'add', '-b', BRANCH, '/work/repo/.adnify/other', 'HEAD'] },
      { name: 'a traversal out of the lane root', args: ['worktree', 'add', '-b', BRANCH, '/work/repo/.adnify/worktrees/../../..', 'HEAD'] },
      { name: 'a symbolic committish', args: ['worktree', 'add', '-b', BRANCH, LANE, 'main'] },
    ])('rejects add with $name', ({ args }) => {
      expect(assess(args).allowed).toBe(false)
    })

    it.each([
      { name: 'a path outside the lane root', args: ['worktree', 'remove', '/work/repo/src'] },
      { name: 'two paths', args: ['worktree', 'remove', LANE, `${LANE}-2`] },
      { name: 'an unknown flag', args: ['worktree', 'remove', '--all'] },
    ])('rejects remove with $name', ({ args }) => {
      expect(assess(args).allowed).toBe(false)
    })

    it.each([
      { name: 'list without --porcelain', args: ['worktree', 'list'] },
      { name: 'list with extra flags', args: ['worktree', 'list', '--porcelain', '-v'] },
      { name: 'prune with operands', args: ['worktree', 'prune', '--expire', 'now'] },
    ])('rejects $name', ({ args }) => {
      expect(assess(args).allowed).toBe(false)
    })

    it('explains why a command was refused', () => {
      const decision = assess(['worktree', 'add', '-b', 'feature/x', LANE, 'HEAD'])
      expect(decision.allowed).toBe(false)
      if (!decision.allowed) expect(decision.reason).toContain('adnify/lane-')
    })
  })
})
