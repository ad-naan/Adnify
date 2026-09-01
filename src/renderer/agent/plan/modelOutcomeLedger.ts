import type { ModelOutcome, ModelRecommendation, PlanTask, TaskPlan } from './types'

interface Aggregate {
  provider: string
  model: string
  outcomes: ModelOutcome[]
}

interface RankedAggregate extends Aggregate {
  successRate: number
  averageDuration: number
  score: number
}

/** 样本太少的模型不参与推荐：一次成功不足以说明什么。 */
const MIN_SAMPLE_SIZE = 2

function rank(aggregates: Iterable<Aggregate>): RankedAggregate[] {
  return [...aggregates]
    .filter(item => item.outcomes.length >= MIN_SAMPLE_SIZE)
    .map(item => {
      const successes = item.outcomes.filter(outcome => outcome.succeeded).length
      const successRate = successes / item.outcomes.length
      const averageDuration = item.outcomes.reduce((sum, outcome) => sum + outcome.duration, 0) / item.outcomes.length
      const averageReviews = item.outcomes.reduce((sum, outcome) => sum + outcome.reviewLoops, 0) / item.outcomes.length
      const score = successRate * 100 - Math.min(20, averageReviews * 4) - Math.min(15, averageDuration / 120_000)
      return { ...item, successRate, averageDuration, score }
    })
    .sort((a, b) => b.score - a.score || b.outcomes.length - a.outcomes.length)
}

/**
 * 把所有历史 outcome 按 executionClass 建一次索引，返回一个按任务查推荐的函数。
 *
 * 存在的理由是复杂度：推荐结果只取决于任务的 executionClass，而扫描范围是"所有计划的所有
 * 任务"。逐个待执行任务各扫一遍就是 O(待执行任务 × 计划 × 任务)，一个攒了几十个计划的
 * 工作区启动执行时会明显卡顿。批量场景一律用这个，别在循环里调 `recommendModelForTask`。
 */
export function createModelRecommender(
  plans: TaskPlan[],
  allowed?: Set<string>,
): (task: PlanTask) => ModelRecommendation | null {
  const byExecutionClass = new Map<string, Map<string, Aggregate>>()
  for (const plan of plans) {
    for (const item of plan.tasks) {
      const outcome = item.modelOutcome
      if (!outcome) continue
      const key = `${outcome.provider}\u0000${outcome.model}`
      if (allowed && !allowed.has(key)) continue
      let groups = byExecutionClass.get(outcome.executionClass)
      if (!groups) {
        groups = new Map()
        byExecutionClass.set(outcome.executionClass, groups)
      }
      const aggregate = groups.get(key) || { provider: outcome.provider, model: outcome.model, outcomes: [] }
      aggregate.outcomes.push(outcome)
      groups.set(key, aggregate)
    }
  }

  // 排名结果按 executionClass 缓存：同一类的任务往往成批出现。
  const rankedCache = new Map<string, RankedAggregate[]>()
  return task => {
    const executionClass = task.executionClass || 'general'
    let ranked = rankedCache.get(executionClass)
    if (!ranked) {
      ranked = rank(byExecutionClass.get(executionClass)?.values() ?? [])
      rankedCache.set(executionClass, ranked)
    }
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
}

/** 单个任务的推荐。批量调用请改用 `createModelRecommender`，否则会重复扫描全部历史。 */
export function recommendModelForTask(task: PlanTask, plans: TaskPlan[], allowed?: Set<string>): ModelRecommendation | null {
  return createModelRecommender(plans, allowed)(task)
}
