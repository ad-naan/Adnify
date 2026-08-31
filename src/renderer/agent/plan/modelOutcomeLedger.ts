import type { ModelOutcome, ModelRecommendation, PlanTask, TaskPlan } from './types'

interface Aggregate {
  provider: string
  model: string
  outcomes: ModelOutcome[]
}

export function recommendModelForTask(task: PlanTask, plans: TaskPlan[], allowed?: Set<string>): ModelRecommendation | null {
  const executionClass = task.executionClass || 'general'
  const groups = new Map<string, Aggregate>()
  for (const outcome of plans.flatMap(plan => plan.tasks.map(item => item.modelOutcome).filter((item): item is ModelOutcome => Boolean(item)))) {
    if (outcome.executionClass !== executionClass) continue
    const key = `${outcome.provider}\u0000${outcome.model}`
    if (allowed && !allowed.has(key)) continue
    const aggregate = groups.get(key) || { provider: outcome.provider, model: outcome.model, outcomes: [] }
    aggregate.outcomes.push(outcome)
    groups.set(key, aggregate)
  }

  const ranked = [...groups.values()].filter(item => item.outcomes.length >= 2).map(item => {
    const successes = item.outcomes.filter(outcome => outcome.succeeded).length
    const successRate = successes / item.outcomes.length
    const averageDuration = item.outcomes.reduce((sum, outcome) => sum + outcome.duration, 0) / item.outcomes.length
    const averageReviews = item.outcomes.reduce((sum, outcome) => sum + outcome.reviewLoops, 0) / item.outcomes.length
    const score = successRate * 100 - Math.min(20, averageReviews * 4) - Math.min(15, averageDuration / 120_000)
    return { ...item, successes, successRate, averageDuration, score }
  }).sort((a, b) => b.score - a.score || b.outcomes.length - a.outcomes.length)

  const best = ranked[0]
  if (!best) return null
  return {
    provider: best.provider,
    model: best.model,
    sampleSize: best.outcomes.length,
    successRate: best.successRate,
    averageDuration: best.averageDuration,
    reason: `${Math.round(best.successRate * 100)}% success across ${best.outcomes.length} similar local tasks`,
  }
}
