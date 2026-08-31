import type { StructuredSummary } from '@/renderer/agent/domains/context/types'

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

export function createThreadLinkMarkdown(threadId: string, title: string, language = 'zh'): string {
  return `[${language === 'zh' ? `会话：${title}` : `Thread: ${title}`}](${createThreadDeepLink(threadId)})`
}

function addList(lines: string[], title: string, items: string[], limit = 8): void {
  if (items.length === 0) return
  lines.push('', `### ${title}`, ...items.slice(0, limit).map(item => `- ${item}`))
}

export function formatStructuredThreadReference(
  threadId: string,
  title: string,
  summary: StructuredSummary,
  language = 'zh',
): string {
  const zh = language === 'zh'
  const lines = [
    `> ${zh ? '引用' : 'Reference'} ${createThreadLinkMarkdown(threadId, title, language)}`,
    '',
    `### ${zh ? '目标' : 'Objective'}`,
    summary.objective,
  ]

  addList(lines, zh ? '已完成' : 'Completed', summary.completedSteps)
  addList(lines, zh ? '待处理' : 'Pending', summary.pendingSteps)
  addList(lines, zh ? '关键决定' : 'Key decisions', summary.decisions.map(decision => decision.description))
  addList(lines, zh ? '用户约束' : 'User constraints', summary.userInstructions)
  addList(lines, zh ? '相关文件' : 'Related files', summary.fileChanges.map(change => `${change.action}: ${change.path}`), 10)
  return lines.join('\n')
}

export function formatGeneratedThreadReference(
  threadId: string,
  title: string,
  summary: GeneratedThreadSummary,
  language = 'zh',
): string {
  const zh = language === 'zh'
  const lines = [
    `> ${zh ? '引用' : 'Reference'} ${createThreadLinkMarkdown(threadId, title, language)}`,
    '',
    `### ${zh ? '上下文摘要' : 'Context summary'}`,
    summary.summary || summary.objective,
  ]

  addList(lines, zh ? '已完成' : 'Completed', summary.completedSteps)
  addList(lines, zh ? '待处理' : 'Pending', summary.pendingSteps)
  addList(lines, zh ? '相关文件' : 'Related files', summary.fileChanges.map(change => `${change.action}: ${change.path}`), 10)
  return lines.join('\n')
}
