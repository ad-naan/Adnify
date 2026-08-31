import { describe, expect, it } from 'vitest'
import { recommendModelForTask } from '@/renderer/agent/plan/modelOutcomeLedger'
import type { ModelOutcome, PlanTask, TaskPlan } from '@/renderer/agent/plan/types'

const outcome = (provider: string, model: string, succeeded: boolean, duration = 10_000): ModelOutcome => ({
  provider, model, succeeded, duration, reviewLoops: 1, executionClass: 'write-heavy', recordedAt: Date.now(),
})
const task = (id: string, modelOutcome?: ModelOutcome): PlanTask => ({
  id, title: id, description: id, provider: 'p', model: 'current', role: 'coder', dependencies: [], status: 'completed', executionClass: 'write-heavy', modelOutcome,
})
const plan = (tasks: PlanTask[]): TaskPlan => ({ id: 'plan', name: 'plan', createdAt: 1, updatedAt: 1, requirementsDoc: 'r.md', executionMode: 'parallel', status: 'completed', tasks })

describe('modelOutcomeLedger', () => {
  it('requires two local samples and ranks successful configured models', () => {
    const target = task('target')
    const plans = [plan([
      task('a1', outcome('a', 'fast', true)), task('a2', outcome('a', 'fast', true)),
      task('b1', outcome('b', 'bad', false)), task('b2', outcome('b', 'bad', true)),
    ])]
    expect(recommendModelForTask(target, plans, new Set(['a\u0000fast', 'b\u0000bad']))).toMatchObject({ provider: 'a', model: 'fast', sampleSize: 2, successRate: 1 })
  })

  it('does not recommend from a single anecdote', () => {
    expect(recommendModelForTask(task('target'), [plan([task('one', outcome('a', 'm', true))])])).toBeNull()
  })
})
