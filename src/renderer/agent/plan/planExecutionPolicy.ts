import type { PlanTask } from './types'

const WRITE_ROLE_RE = /coder|developer|engineer|implement|frontend|backend|ui|ux/i

export function planTaskMayWrite(task: PlanTask): boolean {
  if (task.executionClass === 'analysis-read-heavy') return false
  return task.executionClass === 'write-heavy'
    || Boolean(task.producesFiles?.length)
    || WRITE_ROLE_RE.test(task.role || '')
}
