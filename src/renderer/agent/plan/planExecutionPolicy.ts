/**
 * Plan 任务的执行属性判定。
 */
import type { PlanTask } from './types'

/**
 * 任务是否可能写仓库 —— 也就是并行执行时是否需要独立车道。
 *
 * 默认往"需要隔离"这一侧失败：只有明确标为只读分析的任务才共享工作区。
 * 角色名匹配（coder/frontend/...）只能作为补充信号，不能当作判定依据 ——
 * 一个叫 "refactor docs" 的任务同样会写文件，猜错的代价是两个并行写者互相
 * 覆盖，而多开一条车道的代价只是一次 worktree 创建。
 */
export function planTaskMayWrite(task: PlanTask): boolean {
  return task.executionClass !== 'analysis-read-heavy'
}
