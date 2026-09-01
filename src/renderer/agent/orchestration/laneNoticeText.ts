/**
 * 车道提示文案的唯一出口。
 *
 * 车道逻辑跑在 service 层，那里没有语言上下文，所以它只回传原因码 + 参数；
 * 把它变成人话这件事只在这里做一次。之前的做法是 service 直接拼英文句子、
 * UI 再各自写一遍 `language === 'zh' ? '…' : '…'`，同一条提示散在四个文件里，
 * 改一句文案要翻四处、漏一处就中英混排。
 *
 * `language` 是显式参数而不是在这里读 store：这样这个模块只依赖 i18n 与共享类型，
 * 组件可以传响应式的语言（切换语言会重渲染），而不是一个取过就固定的快照。
 */
import { t, type Language } from '@/renderer/i18n'
import type { ExecutionLaneNotice } from '@/shared/types/executionLane'

/** 车道文案需要的最小信息（service 的 completion 和 UI 的 projection 都满足） */
export interface LaneTextSource {
  branch?: string
  path?: string
  archived?: boolean
  notice?: ExecutionLaneNotice
  /** 兜底的诊断文本（Git 原始报错），只在没有原因码时才展示 */
  error?: string
}

/**
 * 原因码 → 文案。
 *
 * `worktreeLane.reason.${code}` 是模板字面量类型，少一个 key 会在编译期报错，
 * 所以新增原因码时不可能忘记补翻译。
 */
export function laneNoticeText(
  notice: ExecutionLaneNotice | undefined,
  language: Language,
  fallback?: string,
): string {
  if (!notice) return fallback ?? ''
  return t(`worktreeLane.reason.${notice.code}`, language, notice.params)
}

/** 车道现在在哪：已归档（只剩分支）还是目录仍在磁盘上 */
export function lanePlacementText(lane: LaneTextSource, language: Language): string {
  if (lane.archived) {
    return lane.branch ? t('worktreeLane.placement.archived', language, { branch: lane.branch }) : ''
  }
  return lane.path ? t('worktreeLane.placement.onDisk', language, { path: lane.path }) : ''
}

/**
 * 完整的一句：为什么没合并 + 车道现在在哪。
 *
 * 带上 Git 原文：`mergeFailed` 这类原因码只说"合并失败"，而失败原因可能是真冲突、
 * 也可能是 `index.lock` 被占或 fast-forward 被拒 —— 只给译文的话用户没有任何线索
 * 能区分，而这条信息我们本来就有。
 */
export function laneOutcomeText(lane: LaneTextSource, language: Language): string {
  const parts = [laneNoticeText(lane.notice, language, lane.error), lanePlacementText(lane, language)]
  // notice 已经把 error 当兜底用掉时不要重复
  if (lane.error && lane.notice) parts.push(t('worktreeLane.detail', language, { detail: lane.error }))
  return parts.filter(Boolean).join(' ')
}
