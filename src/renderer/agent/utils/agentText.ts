/**
 * Agent 侧的文案取值。
 *
 * 和 `@shared/i18n` 的区别只有一个：默认语言从 store 里取，省得每个调用点都传一遍。
 * 语言类型、`t()`、双语数据的取值都复用 shared 的实现，这里不再重复一份。
 */
import { t, type Language } from '@shared/i18n'
import { useStore } from '@store'

export type AgentLanguage = Language

export function getAgentLanguage(): AgentLanguage {
  return useStore.getState().language
}

export function translateAgentText(
  key: Parameters<typeof t>[0],
  params?: Record<string, string | number>,
  language: AgentLanguage = getAgentLanguage()
): string {
  return t(key, language, params)
}
