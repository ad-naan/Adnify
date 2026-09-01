/**
 * 车道 Git 通道的准入矩阵。
 *
 * 这条通道是免审批的，所以"哪些命令被放过"必须是可测的：一旦形状放宽，
 * `git worktree add <任意路径>` 就能把一份完整检出写到工作区之外。
 */
import { describe, expect, it } from 'vitest'
import * as path from 'path'
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
      { name: 'force-deleting a lane branch', args: ['branch', '-D', BRANCH] },
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

    /**
     * 分支删除只放开 `-D <adnify/lane-*>` 这一个形状。
     *
     * 这条通道免审批，所以它同时是"丢弃车道不弹第二个框"的实现和"不能顺手删掉用户分支"
     * 的边界：换个分支名、换个子命令、多带一个参数，都必须回到通用通道去走审批。
     */
    it.each([
      { name: 'a branch outside the lane namespace', args: ['branch', '-D', 'main'] },
      { name: 'the bare lane prefix', args: ['branch', '-D', 'adnify/lane-'] },
      { name: 'a traversal sequence in the branch', args: ['branch', '-D', 'adnify/lane-a..b'] },
      { name: 'whitespace in the branch', args: ['branch', '-D', 'adnify/lane-a b'] },
      { name: 'two branches at once', args: ['branch', '-D', BRANCH, 'main'] },
      { name: 'the safe delete flag', args: ['branch', '-d', BRANCH] },
      { name: 'no flag at all', args: ['branch', BRANCH] },
      { name: 'listing branches', args: ['branch', '--list', 'adnify/lane-*'] },
      { name: 'renaming a branch', args: ['branch', '-m', BRANCH, 'main'] },
      { name: 'a cwd outside the workspace', args: ['branch', '-D', BRANCH], cwd: '/tmp/elsewhere' },
    ])('rejects branch deletion with $name', ({ args, cwd }) => {
      expect(assess(args, cwd).allowed).toBe(false)
    })

    it('explains why a command was refused', () => {
      const decision = assess(['worktree', 'add', '-b', 'feature/x', LANE, 'HEAD'])
      expect(decision.allowed).toBe(false)
      if (!decision.allowed) expect(decision.reason).toContain('adnify/lane-')
    })
  })

  /**
   * Windows 形状的路径。
   *
   * 上面所有用例都是 POSIX 写法，而这个产品的主力平台是 Windows —— 真实入参一律是
   * `D:\repo\.adnify\worktrees\task-x` 这种反斜杠路径，判定全靠 `path.relative` 的
   * 平台行为。免审批通道上"没测过的平台"等于"没有边界"，所以这里按当前盘符拼出真实
   * 路径再跑一遍准入矩阵。只在 win32 上运行：POSIX 下 `D:\...` 只是个普通文件名。
   */
  describe.skipIf(process.platform !== 'win32')('accepts and rejects the same shapes with Windows paths', () => {
    const winRoot = path.resolve('/work/repo')                    // 例如 D:\work\repo
    const winLane = path.join(winRoot, '.adnify', 'worktrees', 'task-1234abcd')
    const winRoots = [winRoot]

    it('accepts a backslash lane path', () => {
      expect(assess(['worktree', 'add', '-b', BRANCH, winLane, 'HEAD'], winRoot, winRoots).allowed).toBe(true)
      expect(assess(['worktree', 'remove', winLane], winRoot, winRoots).allowed).toBe(true)
    })

    it('accepts the forward-slash spelling of the same Windows path', () => {
      const asPosix = winLane.split(path.sep).join('/')
      expect(assess(['worktree', 'remove', asPosix], winRoot, winRoots).allowed).toBe(true)
    })

    it('accepts a case-mismatched drive letter and root', () => {
      // git 报出来的 worktree 路径用的是记录时的大小写，和我们手上的根不一定一致。
      expect(assess(['worktree', 'remove', winLane.toLowerCase()], winRoot, winRoots).allowed).toBe(true)
      expect(assess(['worktree', 'remove', winLane], winRoot.toUpperCase(), [winRoot.toUpperCase()]).allowed).toBe(true)
    })

    it('rejects a backslash traversal out of the lane root', () => {
      const escape = `${winRoot}\\.adnify\\worktrees\\..\\..\\..`
      expect(assess(['worktree', 'remove', escape], winRoot, winRoots).allowed).toBe(false)
    })

    it('rejects a lane path on another drive', () => {
      const otherDrive = `${winRoot[0] === 'Z' ? 'Y' : 'Z'}:\\work\\repo\\.adnify\\worktrees\\task-1234abcd`
      expect(assess(['worktree', 'remove', otherDrive], winRoot, winRoots).allowed).toBe(false)
    })

    it('rejects a cwd outside the workspace root', () => {
      expect(assess(['worktree', 'prune'], path.join(winRoot, '..', 'elsewhere'), winRoots).allowed).toBe(false)
    })
  })
})
