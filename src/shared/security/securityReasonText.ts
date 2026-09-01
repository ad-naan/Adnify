/**
 * 安全审批原因的唯一文案出口。
 *
 * 策略判定（executionPolicy）跑在两个进程里，都没有界面语言上下文，所以它只回原因码；
 * 变成人话这件事只在这里做一次 —— 主进程的原生弹框用它，渲染进程的审批卡片也用它。
 *
 * `securityReason.${code}` 是模板字面量类型，少一个 key 会在编译期报错，
 * 所以新增原因码时不可能忘记补翻译。
 */
import { t, type Language } from '@shared/i18n'
import type { ExecutionReason } from './executionPolicy'

/** 单条原因 */
export function securityReasonText(reason: ExecutionReason, language: Language): string {
  return t(`securityReason.${reason.code}`, language, reason.params)
}

/**
 * 多条原因拼成一句。
 *
 * 分隔符也要翻译：中文用顿分的"；"，英文用"; " —— 直接写死一个的话，另一种语言里
 * 标点会是错的（这正是原来 `${reason}；目标位于工作区外` 那种拼接留下的问题）。
 */
export function securityReasonsText(reasons: readonly ExecutionReason[], language: Language): string {
  return reasons.map(reason => securityReasonText(reason, language)).join(t('securityReason.separator', language))
}
