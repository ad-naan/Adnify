/**
 * 车道状态徽章。
 *
 * 和 WorktreeLanePanel 一样是三个消费面共用的：Plan 任务详情、Agent 会话提示、子 Agent
 * 任务卡。颜色语义（合并=绿、冲突/出错=红、待合并=琥珀、已丢弃=灰）必须一致，否则同一
 * 条车道在不同界面上看起来像两件事 —— 这段 class 三元原来只写在 TaskBoard 里。
 */
import { t, type Language } from '@shared/i18n'
import type { ExecutionLaneProjection } from '@/shared/types/executionLane'

const TONE: Record<ExecutionLaneProjection['status'], string> = {
  active: 'bg-accent/[0.08] text-accent',
  ready: 'bg-amber-400/[0.08] text-amber-500',
  conflict: 'bg-red-400/[0.08] text-red-400',
  failed: 'bg-red-400/[0.08] text-red-400',
  merged: 'bg-emerald-400/[0.08] text-emerald-500',
  discarded: 'bg-surface/60 text-text-muted',
}

export function LaneStatusChip({ status, language, className = '' }: { status: ExecutionLaneProjection['status'], language: Language, className?: string }) {
  return <span className={`rounded px-2 py-1 ${TONE[status]} ${className}`}>
    {t('worktreeLane.chipLabel', language)} · {t(`worktreeLane.status.${status}`, language)}
  </span>
}
