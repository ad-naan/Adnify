import type { ChatThread, ToolCall } from '../types'

type ApprovalThread = Pick<ChatThread, 'id' | 'title' | 'parentThreadId' | 'streamState'>
type Threads = Record<string, ApprovalThread | undefined>
export interface SubtaskApproval {
  threadId: string
  title?: string
  requestId: string
  toolCall: ToolCall
}

function belongsToParent(threads: Threads, thread: ApprovalThread, parentId: string): boolean {
  const visited = new Set([thread.id])
  let id = thread.parentThreadId
  while (id && !visited.has(id)) {
    if (id === parentId) return true
    visited.add(id)
    id = threads[id]?.parentThreadId
  }
  return false
}

/** Return stable thread references so unrelated streaming tokens do not rerender the tray. */
export function selectSubtaskApprovalThreads(threads: Threads, parentId: string | null): ApprovalThread[] {
  if (!parentId) return []
  return Object.values(threads).filter((thread): thread is ApprovalThread => !!thread
    && thread.id !== parentId && belongsToParent(threads, thread, parentId)
    && !!getSubtaskApproval(thread))
}

export function getSubtaskApproval(thread: ApprovalThread): SubtaskApproval | undefined {
  const { phase, requestId, currentToolCall } = thread.streamState
  if (phase !== 'tool_pending' || !requestId || currentToolCall?.status !== 'awaiting') return undefined
  return { threadId: thread.id, title: thread.title, requestId, toolCall: currentToolCall }
}

/** Revalidate the displayed operation and route by both IDs; never use current-thread fallback. */
export function decideSubtaskApproval(
  threads: Threads,
  parentId: string | null,
  approval: SubtaskApproval,
  decide: (requestId: string, toolCallId: string) => void,
): boolean {
  const thread = threads[approval.threadId]
  if (!thread || !parentId || !belongsToParent(threads, thread, parentId)) return false
  const current = getSubtaskApproval(thread)
  if (!current || current.requestId !== approval.requestId || current.toolCall !== approval.toolCall) return false
  decide(current.requestId, current.toolCall.id)
  return true
}
