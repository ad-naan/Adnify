/**
 * 车道专用 Git 通道的准入策略。
 *
 * 为什么需要单独一条通道：
 * `git worktree` 不在用户可信子命令列表里，走 `git:execSecure` 会对每一条车道
 * 弹一次审批 —— 而车道是后台子 agent / Plan 任务在跑的时候创建的，弹框既打断
 * 用户又没有可判断的信息。反过来把 `worktree` 加进全局白名单又太宽：
 * `git worktree add <任意路径>` 能把一份完整检出写到工作区之外。
 *
 * 所以这里只放开一个被严格限定的形状：
 * - 只有 add / remove / list / prune 四个子命令；
 * - add/remove 的目标必须落在 `<工作区根>/.adnify/worktrees/` 之内；
 * - add 的分支必须带 `adnify/lane-` 前缀；
 * - cwd 必须在已授权的工作区根之内。
 *
 * 其余车道操作（add -A / commit / merge / branch -d / status）本来就在可信
 * 子命令列表里，仍然走原来的 `git:execSecure`。
 */
import * as path from 'path'
import { WORKTREE_LANE_BRANCH_PREFIX, WORKTREE_LANE_DIR } from '@shared/constants'

export type WorktreeLaneDecision =
  | { allowed: true; subcommand: 'add' | 'remove' | 'list' | 'prune' }
  | { allowed: false; reason: string }

const LANE_SUBCOMMANDS = new Set(['add', 'remove', 'list', 'prune'])

/** 引用名里不允许出现的字符，以及 Git 自身禁止的 `..` / `@{` 序列。 */
const UNSAFE_REF_PATTERN = /[\s~^:?*[\\\x00-\x1f\x7f]|\.\.|@\{|\.lock$/u

const deny = (reason: string): WorktreeLaneDecision => ({ allowed: false, reason })

function isInside(parent: string, target: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(target))
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function isWithinAnyRoot(target: string, roots: readonly string[]): boolean {
  return roots.some(root => {
    const resolvedRoot = path.resolve(root)
    const resolvedTarget = path.resolve(target)
    if (resolvedRoot === resolvedTarget) return true
    return isInside(resolvedRoot, resolvedTarget)
  })
}

function isLanePath(target: string, roots: readonly string[]): boolean {
  return roots.some(root => isInside(path.join(path.resolve(root), WORKTREE_LANE_DIR), target))
}

function isLaneBranch(branch: string): boolean {
  return branch.startsWith(WORKTREE_LANE_BRANCH_PREFIX)
    && branch.length > WORKTREE_LANE_BRANCH_PREFIX.length
    && !UNSAFE_REF_PATTERN.test(branch)
}

function isCommittish(value: string): boolean {
  return value === 'HEAD' || /^[0-9a-f]{7,40}$/i.test(value)
}

/**
 * 判断一条车道 Git 命令是否可以免审批执行。
 *
 * @param args 未拼接全局参数的原始 Git 参数（必须以 'worktree' 开头）
 * @param cwd 执行目录
 * @param workspaceRoots 当前窗口已授权的工作区根列表
 */
export function assessWorktreeLaneCommand(
  args: readonly string[],
  cwd: string,
  workspaceRoots: readonly string[],
): WorktreeLaneDecision {
  if (!cwd) return deny('缺少执行目录')
  if (workspaceRoots.length === 0) return deny('没有已授权的工作区根，车道通道不可用')
  if (!isWithinAnyRoot(cwd, workspaceRoots)) return deny('执行目录不在已授权的工作区内')

  if (args[0] !== 'worktree') return deny('车道通道只接受 git worktree 命令')
  const subcommand = args[1]
  if (!subcommand || !LANE_SUBCOMMANDS.has(subcommand)) {
    return deny(`车道通道不支持的子命令：${subcommand || '(空)'}`)
  }

  const operands = args.slice(2)
  if (operands.some(operand => typeof operand !== 'string' || operand.length === 0)) {
    return deny('车道命令包含空参数')
  }

  if (subcommand === 'add') {
    const [flag, branch, target, committish, ...rest] = operands
    if (flag !== '-b' || rest.length > 0) return deny('车道创建只接受 worktree add -b <分支> <路径> <提交>')
    if (!branch || !isLaneBranch(branch)) return deny('车道分支必须以 adnify/lane- 开头')
    if (!target || !isLanePath(target, workspaceRoots)) return deny('车道目录必须位于工作区的 .adnify/worktrees 之内')
    if (!committish || !isCommittish(committish)) return deny('车道基点只接受 HEAD 或提交哈希')
    return { allowed: true, subcommand }
  }

  if (subcommand === 'remove') {
    const targets = operands.filter(operand => operand !== '--force')
    if (targets.length !== 1 || operands.length > 2) return deny('车道删除只接受 worktree remove [--force] <路径>')
    if (!isLanePath(targets[0], workspaceRoots)) return deny('车道目录必须位于工作区的 .adnify/worktrees 之内')
    return { allowed: true, subcommand }
  }

  if (subcommand === 'list') {
    if (operands.length !== 1 || operands[0] !== '--porcelain') return deny('车道列举只接受 worktree list --porcelain')
    return { allowed: true, subcommand }
  }

  if (operands.length > 0) return deny('车道回收只接受 worktree prune')
  return { allowed: true, subcommand: 'prune' }
}
