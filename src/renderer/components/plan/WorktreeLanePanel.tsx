/**
 * 车道恢复面板。
 *
 * 车道合并失败后目录会被归档（删掉 worktree 目录、保留分支和提交），所以这里
 * 面对的是一个"只剩分支"的车道：要么重试合并，要么确认丢弃。没有这个入口时，
 * 未合并的提交只能靠用户自己敲 `git branch --list 'adnify/lane-*'` 才能发现。
 *
 * 文案全部走 i18n key：车道的原因文本由 laneNoticeText 统一翻译，组件里不再出现
 * 中英分支。
 */
import { useState } from 'react'
import { GitBranch, GitMerge, Trash2 } from 'lucide-react'
import { Button } from '@/renderer/components/ui'
import { toast } from '@/renderer/components/common/ToastProvider'
import { WorktreeLaneService } from '@/renderer/agent/orchestration/WorktreeLaneService'
import { laneNoticeText, lanePlacementText } from '@/renderer/agent/orchestration/laneNoticeText'
import { t, type Language } from '@renderer/i18n'
import type { ExecutionLaneProjection } from '@/shared/types/executionLane'

interface WorktreeLanePanelProps {
  lane: ExecutionLaneProjection
  workspacePath: string | null
  language: Language
  onResolved: (status: ExecutionLaneProjection['status'], diagnosis?: Pick<ExecutionLaneProjection, 'notice' | 'error' | 'conflicts'>) => void
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
        toast.success(t('worktreeLane.mergedToast', language, { branch }))
        onResolved('merged')
        return
      }
      toast.error(laneNoticeText(result.notice, language, result.error))
      // 把这次失败的诊断一起交回去：冲突文件列表正是用户下一步要看的东西，
      // 只回传 status 会让面板重新渲染成一段没有原因的空文案。
      onResolved(result.conflicts?.length ? 'conflict' : lane.status, {
        notice: result.notice,
        error: result.error,
        conflicts: result.conflicts,
      })
    } finally {
      setBusy(null)
    }
  }

  const drop = async () => {
    if (!window.confirm(t('worktreeLane.dropConfirm', language, { branch }))) return
    setBusy('drop')
    try {
      const result = await WorktreeLaneService.dropLane(workspacePath, { branch, path: lane.archived ? undefined : lane.path })
      if (result.success) {
        toast.success(t('worktreeLane.droppedToast', language, { branch }))
        onResolved('discarded')
        return
      }
      toast.error(laneNoticeText(result.notice, language, result.error || t('worktreeLane.dropFailed', language)))
    } finally {
      setBusy(null)
    }
  }

  return <section className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/[0.05] px-3.5 py-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-amber-500">
          <GitBranch className="h-3.5 w-3.5" />
          {t('worktreeLane.panelTitle', language)}
        </div>
        <div className="mt-1 truncate text-[10px] text-text-secondary">{branch}</div>
        <p className="mt-1 text-[10px] leading-4 text-text-muted">
          {[laneNoticeText(lane.notice, language), lanePlacementText(lane, language)].filter(Boolean).join(' ')}
        </p>
        {lane.conflicts?.length ? <div className="mt-1.5 text-[10px] leading-4 text-text-muted">
          <div className="text-amber-500/80">{t('worktreeLane.conflictFiles', language, { count: lane.conflicts.length })}</div>
          <ul className="mt-0.5 space-y-0.5">
            {lane.conflicts.slice(0, 8).map(file => <li key={file} className="truncate font-mono text-[9px]">{file}</li>)}
          </ul>
          {lane.conflicts.length > 8 && <div className="mt-0.5">…</div>}
        </div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="secondary" disabled={busy !== null} onClick={retry} leftIcon={<GitMerge className="h-3.5 w-3.5" />}>
          {t('worktreeLane.retry', language)}
        </Button>
        <Button size="sm" variant="danger" disabled={busy !== null} onClick={drop} leftIcon={<Trash2 className="h-3 w-3" />}>
          {t('worktreeLane.drop', language)}
        </Button>
      </div>
    </div>
  </section>
}
