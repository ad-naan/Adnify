/**
 * 车道恢复面板。
 *
 * 车道合并失败后目录会被归档（删掉 worktree 目录、保留分支和提交），所以这里
 * 面对的是一个"只剩分支"的车道：要么重试合并，要么确认丢弃。没有这个入口时，
 * 未合并的提交只能靠用户自己敲 `git branch --list 'adnify/lane-*'` 才能发现。
 */
import { useState } from 'react'
import { GitBranch, GitMerge, Trash2 } from 'lucide-react'
import { Button } from '@/renderer/components/ui'
import { toast } from '@/renderer/components/common/ToastProvider'
import { WorktreeLaneService } from '@/renderer/agent/orchestration/WorktreeLaneService'
import type { ExecutionLaneProjection } from '@/shared/types/executionLane'

const copy = (language: string, zh: string, en: string) => language === 'zh' ? zh : en

interface WorktreeLanePanelProps {
  lane: ExecutionLaneProjection
  workspacePath: string | null
  language: string
  onResolved: (status: ExecutionLaneProjection['status']) => void
}

export function WorktreeLanePanel({ lane, workspacePath, language, onResolved }: WorktreeLanePanelProps) {
  const [busy, setBusy] = useState<'merge' | 'drop' | null>(null)

  // 只有归档保留的车道需要人工处理；已合并/已丢弃的车道在仓库里什么都不剩。
  if (!lane.branch || !workspacePath || !['ready', 'conflict', 'failed'].includes(lane.status)) return null

  const branch = lane.branch

  const retry = async () => {
    setBusy('merge')
    try {
      const result = await WorktreeLaneService.retryMerge(workspacePath, branch)
      if (result.success) {
        toast.success(copy(language, `已合并车道 ${branch}`, `Merged lane ${branch}`))
        onResolved('merged')
        return
      }
      const conflicts = result.conflicts?.length ? `：${result.conflicts.join('、')}` : ''
      toast.error(`${result.error || copy(language, '合并失败', 'Merge failed')}${conflicts}`)
      onResolved(result.conflicts?.length ? 'conflict' : lane.status)
    } finally {
      setBusy(null)
    }
  }

  const drop = async () => {
    if (!window.confirm(copy(language, `确定丢弃车道 ${branch}？其提交将无法恢复。`, `Discard lane ${branch}? Its commits cannot be recovered.`))) return
    setBusy('drop')
    try {
      const result = await WorktreeLaneService.dropLane(workspacePath, { branch, path: lane.archived ? undefined : lane.path })
      if (result.success) {
        toast.success(copy(language, `已丢弃车道 ${branch}`, `Discarded lane ${branch}`))
        onResolved('discarded')
        return
      }
      toast.error(result.error || copy(language, '丢弃失败', 'Unable to discard the lane'))
    } finally {
      setBusy(null)
    }
  }

  return <section className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/[0.05] px-3.5 py-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-amber-500">
          <GitBranch className="h-3.5 w-3.5" />
          {copy(language, '保留的 worktree 车道', 'Retained worktree lane')}
        </div>
        <div className="mt-1 truncate text-[10px] text-text-secondary">{branch}</div>
        <p className="mt-1 text-[10px] leading-4 text-text-muted">
          {lane.archived
            ? copy(language, 'worktree 目录已回收，提交仍留在这条分支上。', 'The worktree folder was reclaimed; the commits are still on this branch.')
            : copy(language, 'worktree 目录仍在磁盘上。', 'The worktree folder is still on disk.')}
          {lane.error ? ` ${lane.error}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="secondary" disabled={busy !== null} onClick={retry} leftIcon={<GitMerge className="h-3.5 w-3.5" />}>
          {copy(language, '重新合并', 'Merge again')}
        </Button>
        <Button size="sm" variant="danger" disabled={busy !== null} onClick={drop} leftIcon={<Trash2 className="h-3 w-3" />}>
          {copy(language, '丢弃', 'Discard')}
        </Button>
      </div>
    </div>
  </section>
}
