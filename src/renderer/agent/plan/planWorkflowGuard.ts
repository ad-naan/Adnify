export type PlanPlanningState = 'needs_clarification' | 'waiting_for_answer' | 'ready_to_create' | 'plan_created'

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
    index > latestUserIndex && message.role === 'assistant' && toolNames(message).includes('create_task_plan')
  )
  if (planCreatedAfterRequest) return 'plan_created'

  const clarificationAfterRequest = messages.findIndex((message, index) =>
    index > latestUserIndex && message.role === 'assistant' && toolNames(message).includes('ask_user')
  )
  if (clarificationAfterRequest >= 0) return 'waiting_for_answer'

  for (let index = latestUserIndex - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role === 'tool') continue
    if (message.role === 'assistant' && toolNames(message).includes('ask_user')) return 'ready_to_create'
    break
  }

  return 'needs_clarification'
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
  return null
}

/** After clarification, the next model turn must converge on a structured plan. */
export function selectPlanPlanningTools<T extends { name: string }>(state: PlanPlanningState, tools: readonly T[]): T[] {
  if (state !== 'ready_to_create') return [...tools]
  return tools.filter(tool => tool.name === 'create_task_plan')
}
