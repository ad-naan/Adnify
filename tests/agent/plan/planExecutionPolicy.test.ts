import { describe, expect, it } from 'vitest'
import { planTaskMayWrite } from '@/renderer/agent/plan/planExecutionPolicy'
import type { PlanTask } from '@/renderer/agent/plan/types'

const task = (overrides: Partial<PlanTask>): PlanTask => ({ id: 't', title: 't', description: 't', provider: 'p', model: 'm', role: 'default', dependencies: [], status: 'pending', ...overrides })

describe('planTaskMayWrite', () => {
  it('treats coder roles and declared outputs as writers', () => {
    expect(planTaskMayWrite(task({ role: 'frontend-coder' }))).toBe(true)
    expect(planTaskMayWrite(task({ producesFiles: ['src/a.ts'] }))).toBe(true)
  })

  it('fails safe toward isolation for unclassified tasks', () => {
    expect(planTaskMayWrite(task({ role: 'reviewer' }))).toBe(true)
    expect(planTaskMayWrite(task({ role: 'default', executionClass: 'general' }))).toBe(true)
    expect(planTaskMayWrite(task({ role: 'approver', executionClass: 'approval-heavy' }))).toBe(true)
  })

  it('lets an explicit read-heavy classification opt out of isolation', () => {
    expect(planTaskMayWrite(task({ role: 'coder', executionClass: 'analysis-read-heavy' }))).toBe(false)
  })
})
