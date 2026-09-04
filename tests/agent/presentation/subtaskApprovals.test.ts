import { describe, expect, it, vi } from 'vitest'
import type { ChatThread } from '@renderer/agent/types'
import { decideSubtaskApproval, getSubtaskApproval, selectSubtaskApprovalThreads } from '@renderer/agent/presentation/subtaskApprovals'

function thread(id: string, parentThreadId?: string): Pick<ChatThread, 'id' | 'title' | 'parentThreadId' | 'streamState'> {
  return { id, title: id, parentThreadId, streamState: { phase: 'tool_pending', requestId: `request-${id}`, currentToolCall: { id: `tool-${id}`, name: 'run_command', arguments: { command: `echo ${id}` }, status: 'awaiting' } } }
}

describe('subtask approvals in the parent thread', () => {
  it('includes pending descendants but excludes current and unrelated threads', () => {
    const root = thread('root'), child = thread('child', 'root'), nested = thread('nested', 'child'), unrelated = thread('other')
    expect(selectSubtaskApprovalThreads({ root, child, nested, unrelated }, 'root')).toEqual([child, nested])
    expect(selectSubtaskApprovalThreads({ root, child, nested, unrelated }, 'child')).toEqual([nested])
    expect(selectSubtaskApprovalThreads({ child }, null)).toEqual([])
  })

  it('routes allow and reject to the displayed request and tool, without switching threads', () => {
    const root = thread('root'), a = thread('a', 'root'), b = thread('b', 'root')
    const approve = vi.fn(), reject = vi.fn()
    expect(decideSubtaskApproval({ root, a, b }, 'root', getSubtaskApproval(a)!, approve)).toBe(true)
    expect(approve).toHaveBeenCalledExactlyOnceWith('request-a', 'tool-a')
    expect(decideSubtaskApproval({ root, a, b }, 'root', getSubtaskApproval(b)!, reject)).toBe(true)
    expect(reject).toHaveBeenCalledExactlyOnceWith('request-b', 'tool-b')
    expect(root.streamState.phase).toBe('tool_pending')
  })

  it('rejects stale operations after request, tool, or arguments change', () => {
    const child = thread('child', 'root'), approval = getSubtaskApproval(child)!, decide = vi.fn()
    for (const streamState of [
      { ...child.streamState, requestId: 'next-request' },
      { ...child.streamState, currentToolCall: { ...approval.toolCall, id: 'next-tool' } },
      { ...child.streamState, currentToolCall: { ...approval.toolCall, arguments: { command: 'different operation' } } },
      { ...child.streamState, phase: 'idle' as const },
    ]) expect(decideSubtaskApproval({ child: { ...child, streamState } }, 'root', approval, decide)).toBe(false)
    expect(decide).not.toHaveBeenCalled()
  })

  it('does not approve an unrelated task if the user switches parents before clicking', () => {
    const child = thread('child', 'root'), decide = vi.fn()
    expect(decideSubtaskApproval({ child }, 'other', getSubtaskApproval(child)!, decide)).toBe(false)
    expect(decide).not.toHaveBeenCalled()
  })

  it('does not expose unvalidated queued tools, completed tasks, or missing request IDs', () => {
    const child = thread('child', 'root')
    expect(getSubtaskApproval({ ...child, streamState: { phase: 'tool_running', pendingToolCalls: [child.streamState.currentToolCall!] } })).toBeUndefined()
    expect(getSubtaskApproval({ ...child, streamState: { ...child.streamState, requestId: undefined } })).toBeUndefined()
    expect(getSubtaskApproval({ ...child, streamState: { ...child.streamState, currentToolCall: { ...child.streamState.currentToolCall!, status: 'success' } } })).toBeUndefined()
  })

  it('terminates on malformed cyclic parent relationships', () => {
    const a = thread('a', 'b'), b = thread('b', 'a')
    expect(selectSubtaskApprovalThreads({ a, b }, 'root')).toEqual([])
  })
})
