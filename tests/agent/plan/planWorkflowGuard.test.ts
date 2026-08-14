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
})

describe('selectPlanPlanningTools', () => {
  const tools = [{ name: 'read_file' }, { name: 'report_plan_activity' }, { name: 'create_task_plan' }]

  it('only exposes plan creation after clarification is answered', () => {
    expect(selectPlanPlanningTools('ready_to_create', tools).map(tool => tool.name)).toEqual(['create_task_plan'])
  })

  it('keeps the planning toolset before clarification is complete', () => {
    expect(selectPlanPlanningTools('needs_clarification', tools)).toEqual(tools)
  })
})
