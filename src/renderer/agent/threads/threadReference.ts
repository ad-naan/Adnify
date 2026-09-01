import type { StructuredSummary } from '@/renderer/agent/domains/context/types'
import { t, type Language } from '@shared/i18n'

const THREAD_LINK_PREFIX = 'adnify://agent/thread/'

export interface GeneratedThreadSummary {
  summary: string
  objective: string
  completedSteps: string[]
  pendingSteps: string[]
  fileChanges: Array<{ path: string; action: string }>
}

export function createThreadDeepLink(threadId: string): string {
  return `${THREAD_LINK_PREFIX}${encodeURIComponent(threadId)}`
}

export function parseThreadDeepLink(value: string | undefined): string | null {
  if (!value?.startsWith(THREAD_LINK_PREFIX)) return null
  const encodedId = value.slice(THREAD_LINK_PREFIX.length).split(/[?#]/, 1)[0]
  if (!encodedId) return null

  try {
    return decodeURIComponent(encodedId)
  } catch {
    return null
  }
}

export function createThreadLinkMarkdown(threadId: string, title: string, language: Language): string {
  return `[${t('threadReference.thread', language, { title })}](${createThreadDeepLink(threadId)})`
}

function addList(lines: string[], title: string, items: string[], limit = 8): void {
  if (items.length === 0) return
  lines.push('', `### ${title}`, ...items.slice(0, limit).map(item => `- ${item}`))
}

export function formatStructuredThreadReference(
  threadId: string,
  title: string,
  summary: StructuredSummary,
  language: Language,
): string {
  const lines = [
    `> ${t('threadReference.reference', language)} ${createThreadLinkMarkdown(threadId, title, language)}`,
    '',
    `### ${t('threadReference.objective', language)}`,
    summary.objective,
  ]

  addList(lines, t('common.completed', language), summary.completedSteps)
  addList(lines, t('threadReference.pending', language), summary.pendingSteps)
  addList(lines, t('threadReference.keyDecisions', language), summary.decisions.map(decision => decision.description))
  addList(lines, t('threadReference.userConstraints', language), summary.userInstructions)
  addList(lines, t('threadReference.relatedFiles', language), summary.fileChanges.map(change => `${change.action}: ${change.path}`), 10)
  return lines.join('\n')
}

export function formatGeneratedThreadReference(
  threadId: string,
  title: string,
  summary: GeneratedThreadSummary,
  language: Language,
): string {
  const lines = [
    `> ${t('threadReference.reference', language)} ${createThreadLinkMarkdown(threadId, title, language)}`,
    '',
    `### ${t('threadReference.contextSummary', language)}`,
    summary.summary || summary.objective,
  ]

  addList(lines, t('common.completed', language), summary.completedSteps)
  addList(lines, t('threadReference.pending', language), summary.pendingSteps)
  addList(lines, t('threadReference.relatedFiles', language), summary.fileChanges.map(change => `${change.action}: ${change.path}`), 10)
  return lines.join('\n')
}
