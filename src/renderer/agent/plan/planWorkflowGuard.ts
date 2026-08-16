export type PlanPlanningState =
  | 'needs_clarification'
  | 'waiting_for_answer'
  | 'ready_to_create'
  | 'revision_requested'
  | 'ready_to_update'
  | 'plan_created'

type MessageLike = {
  role?: string
  toolCalls?: Array<{ name?: string }>
  tool_calls?: Array<{ function?: { name?: string } }>
}

function toolNames(message: MessageLike): string[] {
  return [
    ...(message.toolCalls || []).map(call => call.name || ''),
    ...(message.tool_calls || []).map(call => call.function?.name || ''),
  ].filter(Boolean)
}

export function derivePlanPlanningState(messages: readonly MessageLike[]): PlanPlanningState {
  const latestUserIndex = messages.reduce((latest, message, index) => message.role === 'user' ? index : latest, -1)
  if (latestUserIndex < 0) return 'needs_clarification'

  const planCreatedAfterRequest = messages.some((message, index) =>
    index > latestUserIndex
      && message.role === 'assistant'
      && toolNames(message).some(name => name === 'create_task_plan' || name === 'update_task_plan')
  )
  if (planCreatedAfterRequest) return 'plan_created'

  const previousPlanIndex = messages.reduce((latest, message, index) => (
    index < latestUserIndex && message.role === 'assistant' && toolNames(message).includes('create_task_plan')
      ? index
      : latest
  ), -1)
  const isRevision = previousPlanIndex >= 0

  const clarificationAfterRequest = messages.findIndex((message, index) =>
    index > latestUserIndex && message.role === 'assistant' && toolNames(message).includes('ask_user')
  )
  if (clarificationAfterRequest >= 0) return 'waiting_for_answer'

  for (let index = latestUserIndex - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role === 'tool') continue
    if (message.role === 'assistant' && toolNames(message).includes('ask_user')) {
      return isRevision && index > previousPlanIndex ? 'ready_to_update' : 'ready_to_create'
    }
    break
  }

  return isRevision ? 'revision_requested' : 'needs_clarification'
}

export function getPlanContinuationReminder(state: PlanPlanningState): string | null {
  if (state === 'needs_clarification' || state === 'waiting_for_answer') {
    return [
      'PLAN WORKFLOW ENFORCEMENT: You cannot finish this response with prose.',
      'Call ask_user now with one concise grouped question that confirms the missing requirements and important choices.',
      'Do not provide the analysis, solution, or task plan in normal Markdown before the user answers.',
    ].join('\n')
  }
  if (state === 'ready_to_create') {
    return [
      'PLAN WORKFLOW ENFORCEMENT: The user has answered the clarification question.',
      'You cannot finish with a prose-only plan. Call create_task_plan now with the structured tasks and requirements document.',
    ].join('\n')
  }
  if (state === 'revision_requested') {
    return [
      'PLAN REVISION ENFORCEMENT: A structured plan already exists in this conversation.',
      'If the requested change is clear, call update_task_plan for that existing plan. If a material decision is missing, call ask_user once.',
      'Do not call create_task_plan and do not create a duplicate plan.',
    ].join('\n')
  }
  if (state === 'ready_to_update') {
    return [
      'PLAN REVISION ENFORCEMENT: The user has answered the revision clarification.',
      'Call update_task_plan for the existing plan now. Do not call create_task_plan.',
    ].join('\n')
  }
  return null
}

/** After clarification, the next model turn must converge on a structured plan. */
export function selectPlanPlanningTools<T extends { name: string }>(state: PlanPlanningState, tools: readonly T[]): T[] {
  if (state === 'ready_to_create') return tools.filter(tool => tool.name === 'create_task_plan')
  if (state === 'ready_to_update') return tools.filter(tool => tool.name === 'update_task_plan')
  if (state === 'revision_requested') return tools.filter(tool => tool.name !== 'create_task_plan')
  return [...tools]
}
