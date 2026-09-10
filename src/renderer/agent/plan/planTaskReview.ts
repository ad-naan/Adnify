import type { PlanTask } from './types'

export interface TaskReviewSnapshot { id: string; title: string; signature: string }

/** Execution output and proof collection must not look like edits to the plan. */
export function snapshotTasksForReview(tasks: PlanTask[]): TaskReviewSnapshot[] {
  return tasks.map(task => ({
    id: task.id,
    title: task.title,
    signature: JSON.stringify({
      title: task.title, description: task.description, provider: task.provider, model: task.model,
      role: task.role, dependencies: [...task.dependencies].sort(), priority: task.priority,
      estimatedTokens: task.estimatedTokens, executionClass: task.executionClass,
      producesFiles: [...(task.producesFiles || [])].sort(), consumesFiles: [...(task.consumesFiles || [])].sort(),
      criteria: task.acceptanceCriteria?.map(criterion => criterion.text),
    }),
  }))
}

export function changedReviewTasks(before: TaskReviewSnapshot[], after: TaskReviewSnapshot[]): TaskReviewSnapshot[] {
  const original = new Map(before.map(task => [task.id, task]))
  const current = new Map(after.map(task => [task.id, task]))
  return [
    ...after.filter(task => original.get(task.id)?.signature !== task.signature),
    ...before.filter(task => !current.has(task.id)),
  ]
}
