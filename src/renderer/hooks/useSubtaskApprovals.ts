import { useShallow } from 'zustand/react/shallow'
import { useAgentStore } from '@renderer/agent/store/AgentStore'
import { Agent } from '@renderer/agent/core/Agent'
import { decideSubtaskApproval, getSubtaskApproval, selectSubtaskApprovalThreads } from '@renderer/agent/presentation/subtaskApprovals'

export function useSubtaskApprovals() {
  const threads = useAgentStore(useShallow(state => selectSubtaskApprovalThreads(state.threads, state.currentThreadId)))
  return { approvals: threads.map(thread => getSubtaskApproval(thread)!), onDecision: (approval: NonNullable<ReturnType<typeof getSubtaskApproval>>, approved: boolean) => {
    const state = useAgentStore.getState()
    return decideSubtaskApproval(state.threads, state.currentThreadId, approval, (requestId, toolCallId) => {
      if (approved) Agent.approve(requestId, toolCallId)
      else Agent.reject(requestId, toolCallId)
    })
  }}
}
