import { describe, it, expect } from 'vitest'
import { getToolsForContext, isToolAvailable } from '@/shared/config/toolGroups'

/**
 * 子代理工具裁剪。
 *
 * 背景：子代理跑的是同一个 agent 模式，因此在加上 isSubAgent 之前它会拿到完整的
 * CORE_TOOLS —— 其中包含 task 本身，也就是子代理可以再派生子代理，无限递归。
 */
describe('getToolsForContext - isSubAgent', () => {
  it('agent 模式下主 agent 持有 task', () => {
    expect(getToolsForContext({ mode: 'agent' })).toContain('task')
  })

  it('agent 模式下子代理不持有 task', () => {
    expect(getToolsForContext({ mode: 'agent', isSubAgent: true })).not.toContain('task')
  })

  it('子代理不持有 ask_user（隐藏线程没有 UI 承接提问，只会挂到超时）', () => {
    const tools = getToolsForContext({ mode: 'plan', planPhase: 'planning', isSubAgent: true })
    expect(getToolsForContext({ mode: 'plan', planPhase: 'planning' })).toContain('ask_user')
    expect(tools).not.toContain('ask_user')
  })

  it('子代理不持有计划编排工具（计划是全局单例状态）', () => {
    const tools = getToolsForContext({ mode: 'plan', planPhase: 'executing', isSubAgent: true })
    for (const tool of ['create_task_plan', 'update_task_plan', 'start_task_execution']) {
      expect(tools, tool).not.toContain(tool)
    }
  })

  it('只裁剪被排除的工具，其余照常保留', () => {
    const main = getToolsForContext({ mode: 'agent' })
    const sub = getToolsForContext({ mode: 'agent', isSubAgent: true })
    const removed = main.filter(tool => !sub.includes(tool))
    expect(removed.sort()).toEqual(['task'])
    // 干活需要的读写工具一个都不能少
    for (const tool of ['read_file', 'edit_file', 'run_command', 'codebase_search']) {
      expect(sub, tool).toContain(tool)
    }
  })

  it('角色专属工具在子代理里同样保留', () => {
    const sub = getToolsForContext({ mode: 'agent', templateId: 'uiux-designer', isSubAgent: true })
    expect(sub).toContain('uiux_search')
    expect(sub).not.toContain('task')
  })

  it('isToolAvailable 走同一套裁剪', () => {
    expect(isToolAvailable('task', { mode: 'agent' })).toBe(true)
    expect(isToolAvailable('task', { mode: 'agent', isSubAgent: true })).toBe(false)
  })

  it('chat 模式无工具，加不加 isSubAgent 都是空', () => {
    expect(getToolsForContext({ mode: 'chat', isSubAgent: true })).toEqual([])
  })
})
