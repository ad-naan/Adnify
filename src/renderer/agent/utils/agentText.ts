import { t } from '@/renderer/i18n'
import { useStore } from '@store'

export type AgentLanguage = 'en' | 'zh'

export function getAgentLanguage(): AgentLanguage {
  return useStore.getState().language as AgentLanguage
}

export function translateAgentText(
  key: Parameters<typeof t>[0],
  params?: Record<string, string | number>,
  language: AgentLanguage = getAgentLanguage()
): string {
  return t(key, language, params)
}

export function pickLocalizedText(
  zh: string,
  en: string,
  language: AgentLanguage = getAgentLanguage()
): string {
  return language === 'zh' ? zh : en
}
