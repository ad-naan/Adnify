import type { ChatThread, InteractiveContent, InteractiveOption } from '../types'

export interface InteractiveAnswer {
  selectedIds: string[]
  customText?: string
}

export function buildInteractiveResponse(
  content: InteractiveContent,
  answer: InteractiveAnswer,
): string {
  const customText = answer.customText?.trim()
  if (customText) return customText

  return content.options
    .filter(option => answer.selectedIds.includes(option.id))
    .map(option => option.label)
    .join(', ')
}

/** 是不是"自定义/其他"那一行：id 里的 custom/other 要单独成词，避免 customary 撞上。 */
export function isCustomOption(option: Pick<InteractiveOption, 'id' | 'label'>) {
  const id = option.id.toLowerCase()
  const label = option.label.toLowerCase()
  return /(^|[-_])(custom|other)([-_]|$)/.test(id)
    || ['其他', '自定义', 'custom', 'other'].includes(label.trim())
}

/** 提交意图：单选文本优先，多选文本必须挂在自定义选项上才作数。 */
export type InteractiveSubmission =
  | { kind: 'choice'; ids: string[]; text?: undefined }
  | { kind: 'custom'; ids: string[]; text: string }

/**
 * 把"点了什么"翻成"回答什么"，与渲染无关，因此可以单测。
 *
 * 一条规则管两种模式：回答本身要么是选中的选项，要么是写下的文本。
 * - 什么都没选：文本就是全部回答。
 * - 选中了自定义项：文本优先（`buildInteractiveResponse` 同样以文本为答案）。
 * - 只选了普通选项：文本不算回答，避免"顺手写了一句"被当成答案送出去。
 */
export function resolveInteractiveSubmission(
  options: InteractiveOption[],
  selectedIds: readonly string[],
  customText: string,
): InteractiveSubmission | null {
  const selected = options.filter(option => selectedIds.includes(option.id))
  const ids = selected.map(option => option.id)
  const text = customText.trim()

  if (selected.length === 0) return text ? { kind: 'custom', ids, text } : null
  if (selected.some(isCustomOption)) return text ? { kind: 'custom', ids, text } : null
  return { kind: 'choice', ids }
}

/**
 * 自定义输入框的开合：草稿还在就保持展开。
 *
 * 输入框只在自定义行"被选中"时出现，但用户取消勾选通常只是想换个选项 ——
 * 顺手清掉刚写的草稿是数据的丢失，不是状态的同步。
 */
export function decideCustomDraftVisibility(wasVisible: boolean, draft: string): boolean {
  return wasVisible && draft.trim().length > 0
}

export function findThreadIdForMessage(
  threads: Record<string, ChatThread>,
  messageId: string,
): string | null {
  for (const [threadId, thread] of Object.entries(threads)) {
    if (thread.messages.some(message => message.id === messageId)) return threadId
  }
  return null
}
