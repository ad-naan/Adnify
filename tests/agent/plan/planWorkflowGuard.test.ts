import { describe, expect, it } from 'vitest'
import { derivePlanPlanningState, getPlanContinuationReminder, selectPlanPlanningTools } from '@/renderer/agent/plan/planWorkflowGuard'

describe('planWorkflowGuard', () => {
  it('requires clarification for a new Plan request', () => {
    const state = derivePlanPlanningState([{ role: 'user' }])
    expect(state).toBe('needs_clarification')
    expect(getPlanContinuationReminder(state)).toContain('ask_user')
  })

  it('waits after ask_user instead of accepting a prose answer', () => {
    const state = derivePlanPlanningState([
      { role: 'user' },
      { role: 'assistant', tool_calls: [{ function: { name: 'ask_user' } }] },
    ])
    expect(state).toBe('waiting_for_answer')
  })

  it('requires create_task_plan after the user answers clarification', () => {
    const state = derivePlanPlanningState([
      { role: 'user' },
      { role: 'assistant', toolCalls: [{ name: 'ask_user' }] },
      { role: 'tool' },
      { role: 'user' },
    ])
    expect(state).toBe('ready_to_create')
    expect(getPlanContinuationReminder(state)).toContain('create_task_plan')
  })

  it('recognizes ask_user in ChatMessage parts format', () => {
    const state = derivePlanPlanningState([
      { role: 'user' },
      {
        role: 'assistant',
        parts: [{ type: 'tool_call', toolCall: { name: 'ask_user' } }],
      },
      { role: 'user' },
    ])
    expect(state).toBe('ready_to_create')
  })

  it('recognizes ask_user in ChatMessage interactive card format', () => {
    const state = derivePlanPlanningState([
      { role: 'user' },
      {
        role: 'assistant',
        interactive: { question: 'Confirm plan?' },
      },
      { role: 'user' },
    ])
    expect(state).toBe('ready_to_create')
  })

  it('allows completion only after a structured plan tool call', () => {
    const state = derivePlanPlanningState([
      { role: 'user' },
      { role: 'assistant', toolCalls: [{ name: 'ask_user' }] },
      { role: 'user' },
      { role: 'assistant', toolCalls: [{ name: 'create_task_plan' }] },
    ])
    expect(state).toBe('plan_created')
    expect(getPlanContinuationReminder(state)).toBeNull()
  })

  it('routes a clear follow-up request to revision instead of creating a duplicate plan', () => {
    const state = derivePlanPlanningState([
      { role: 'user' },
      { role: 'assistant', toolCalls: [{ name: 'ask_user' }] },
      { role: 'user' },
      { role: 'assistant', toolCalls: [{ name: 'create_task_plan' }] },
      { role: 'user' },
    ])

    expect(state).toBe('revision_requested')
    expect(getPlanContinuationReminder(state)).toContain('update_task_plan')
    expect(getPlanContinuationReminder(state)).toContain('Do not call create_task_plan')
  })

  it('routes a clarified follow-up to update_task_plan', () => {
    const state = derivePlanPlanningState([
      { role: 'user' },
      { role: 'assistant', toolCalls: [{ name: 'ask_user' }] },
      { role: 'user' },
      { role: 'assistant', toolCalls: [{ name: 'create_task_plan' }] },
      { role: 'user' },
      { role: 'assistant', toolCalls: [{ name: 'ask_user' }] },
      { role: 'tool' },
      { role: 'user' },
    ])

    expect(state).toBe('ready_to_update')
    expect(getPlanContinuationReminder(state)).toContain('update_task_plan')
  })

  it('completes the revision state after update_task_plan runs', () => {
    const state = derivePlanPlanningState([
      { role: 'user' },
      { role: 'assistant', toolCalls: [{ name: 'ask_user' }] },
      { role: 'user' },
      { role: 'assistant', toolCalls: [{ name: 'create_task_plan' }] },
      { role: 'user' },
      { role: 'assistant', toolCalls: [{ name: 'update_task_plan' }] },
    ])

    expect(state).toBe('plan_created')
    expect(getPlanContinuationReminder(state)).toBeNull()
  })
})

describe('selectPlanPlanningTools', () => {
  const tools = [{ name: 'read_file' }, { name: 'ask_user' }, { name: 'report_plan_activity' }, { name: 'create_task_plan' }, { name: 'update_task_plan' }]

  it('only exposes plan creation after clarification is answered', () => {
    expect(selectPlanPlanningTools('ready_to_create', tools).map(tool => tool.name)).toEqual(['create_task_plan'])
  })

  it('keeps the planning toolset before clarification is complete', () => {
    expect(selectPlanPlanningTools('needs_clarification', tools)).toEqual(tools)
  })

  it('prevents duplicate creation while a revision request is being handled', () => {
    expect(selectPlanPlanningTools('revision_requested', tools).map(tool => tool.name)).toEqual([
      'read_file',
      'ask_user',
      'report_plan_activity',
      'update_task_plan',
    ])
  })

  it('only exposes update_task_plan after revision clarification', () => {
    expect(selectPlanPlanningTools('ready_to_update', tools).map(tool => tool.name)).toEqual(['update_task_plan'])
  })
})
