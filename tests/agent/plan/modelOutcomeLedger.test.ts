import { describe, expect, it } from 'vitest'
import { createModelRecommender, recommendModelForTask } from '@/renderer/agent/plan/modelOutcomeLedger'
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

  it('batch recommender matches the single-shot call and keeps execution classes apart', () => {
    const plans = [plan([
      task('a1', outcome('a', 'fast', true)), task('a2', outcome('a', 'fast', true)),
      task('r1', { ...outcome('r', 'reader', true), executionClass: 'analysis-read-heavy' }),
      task('r2', { ...outcome('r', 'reader', true), executionClass: 'analysis-read-heavy' }),
    ])]
    const recommend = createModelRecommender(plans)
    const write = task('write')
    const read: PlanTask = { ...task('read'), executionClass: 'analysis-read-heavy' }

    expect(recommend(write)).toEqual(recommendModelForTask(write, plans))
    expect(recommend(write)).toMatchObject({ provider: 'a', model: 'fast' })
    // 同一个索引连续查两个 executionClass：缓存不能把上一个类的排名串给下一个。
    expect(recommend(read)).toMatchObject({ provider: 'r', model: 'reader' })
    expect(recommend(write)).toMatchObject({ provider: 'a', model: 'fast' })
    expect(recommend({ ...task('other'), executionClass: 'general' })).toBeNull()
  })
})
