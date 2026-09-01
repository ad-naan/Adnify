import { describe, expect, it } from 'vitest'
import { planTaskMayWrite } from '@/renderer/agent/plan/planExecutionPolicy'
import type { PlanTask } from '@/renderer/agent/plan/types'

const task = (overrides: Partial<PlanTask>): PlanTask => ({ id: 't', title: 't', description: 't', provider: 'p', model: 'm', role: 'default', dependencies: [], status: 'pending', ...overrides })

describe('planTaskMayWrite', () => {
  /**
   * 判定只看 `executionClass`：角色名和 `producesFiles` 都不参与。
   *
   * 下面这组用例是在钉这一点，而不是在测"识别 coder 角色"——`frontend-coder` 返回 true
   * 是因为默认就往"需要隔离"失败，不是因为实现认识这个角色名。如果哪天加了"按角色猜是否
   * 写文件"的启发式，`reviewer` / `approver` 会第一批变成 false，于是两个并行写者共用一个
   * 工作区互相覆盖 —— 这些断言就是那道防线。
   */
  it('isolates every task whose class is not explicitly read-heavy', () => {
    expect(planTaskMayWrite(task({ role: 'frontend-coder' }))).toBe(true)
    expect(planTaskMayWrite(task({ producesFiles: ['src/a.ts'] }))).toBe(true)
    expect(planTaskMayWrite(task({ role: 'reviewer' }))).toBe(true)
    expect(planTaskMayWrite(task({ role: 'default', executionClass: 'general' }))).toBe(true)
    expect(planTaskMayWrite(task({ role: 'approver', executionClass: 'approval-heavy' }))).toBe(true)
  })

  it('lets an explicit read-heavy classification opt out, whatever the role suggests', () => {
    expect(planTaskMayWrite(task({ role: 'coder', executionClass: 'analysis-read-heavy' }))).toBe(false)
    // 角色和产物都指向"会写"，显式分类仍然优先 —— 否则这个 opt-out 根本没法生效。
    expect(planTaskMayWrite(task({ role: 'frontend-coder', producesFiles: ['src/a.ts'], executionClass: 'analysis-read-heavy' }))).toBe(false)
  })
})
