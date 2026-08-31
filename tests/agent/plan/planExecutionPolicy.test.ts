import { describe, expect, it } from 'vitest'
import { planTaskMayWrite } from '@/renderer/agent/plan/planExecutionPolicy'
import type { PlanTask } from '@/renderer/agent/plan/types'

const task = (overrides: Partial<PlanTask>): PlanTask => ({ id: 't', title: 't', description: 't', provider: 'p', model: 'm', role: 'default', dependencies: [], status: 'pending', ...overrides })

describe('planTaskMayWrite', () => {
  it('treats coder roles and declared outputs as writers', () => {
    expect(planTaskMayWrite(task({ role: 'frontend-coder' }))).toBe(true)
    expect(planTaskMayWrite(task({ producesFiles: ['src/a.ts'] }))).toBe(true)
  })

  it('lets an explicit read-heavy classification override role heuristics', () => {
    expect(planTaskMayWrite(task({ role: 'coder', executionClass: 'analysis-read-heavy' }))).toBe(false)
  })
})
