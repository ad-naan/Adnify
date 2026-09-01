/**
 * 日期时间处理工具函数
 */

import { t, toLocaleTag, type Language } from '@shared/i18n'

/**
 * 相对时间描述（"刚刚"、"5m ago"、超过一周则给具体日期）。
 *
 * 语言参数不给默认值：这个函数的每个调用点都能拿到当前语言，一个 `= 'en'` 的默认值
 * 只会让漏传的地方静默显示英文，而不是被类型检查拦下来。
 */
export function getRelativeTime(timestamp: number, language: Language): string {
  const now = Date.now()
  const diff = now - timestamp

  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  // diff < 0 是未来时间（时钟回拨、服务端时间偏差），和"刚刚"归一处理，
  // 否则会算出负的分钟数显示成 "-3m ago"。
  if (diff < minute) return t('dateUtils.justNow', language)

  if (diff < hour) return t('dateUtils.minutesAgo', language, { minutes: Math.floor(diff / minute) })

  if (diff < day) return t('dateUtils.hoursAgo', language, { hours: Math.floor(diff / hour) })

  if (diff < 2 * day) return t('dateUtils.yesterday', language)

  if (diff < 7 * day) return t('dateUtils.daysAgo', language, { days: Math.floor(diff / day) })

  return new Date(timestamp).toLocaleDateString(toLocaleTag(language), {
    month: 'short',
    day: 'numeric',
    // 不是今年才显示年份
    year: new Date(timestamp).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  })
}
