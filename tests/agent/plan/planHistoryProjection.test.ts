import { describe, expect, it } from 'vitest'
import { projectPlanHistory } from '@/renderer/agent/plan/planHistoryProjection'
import { createEmptyThread } from '@/renderer/agent/store/slices/threadSlice'
import type { TaskPlan } from '@/renderer/agent/plan/types'

describe('projectPlanHistory', () => {
  it('combines saved plans and unfinished plan conversations without duplicates', () => {
    const linked = { ...createEmptyThread({ mode: 'plan', origin: 'user' }), id: 'linked', title: 'linked thread', lastModified: 20 }
    linked.messages = [{ id: 'linked-user', role: 'user', content: 'linked request', timestamp: 10 }]
    const draft = { ...createEmptyThread({ mode: 'plan', origin: 'user' }), id: 'draft', title: '尚未创建计划', lastModified: 40 }
    draft.messages = [{ id: 'draft-user', role: 'user', content: 'draft request', timestamp: 30 }]
    const worker = { ...createEmptyThread({ mode: 'plan', origin: 'plan-task', planId: 'plan-1', taskId: 'task-1' }), id: 'worker', lastModified: 50 }
    worker.messages = [{ id: 'worker-user', role: 'user', content: 'worker task', timestamp: 45 }]
    const plan: TaskPlan = {
      id: 'plan-1', name: '已保存计划', createdAt: 1, updatedAt: 35, requirementsDoc: 'plan.md',
      executionMode: 'parallel', status: 'executing', originThreadId: linked.id,
      tasks: [{ id: 'task-1', title: '任务', description: '任务', provider: 'openai', model: 'test', role: 'worker', dependencies: [], status: 'completed', threadId: worker.id }],
    }

    const entries = projectPlanHistory([plan], { linked, draft, worker })
    expect(entries.map(entry => entry.id)).toEqual(['thread:draft', 'plan:plan-1'])
    expect(entries[1]).toMatchObject({ threadId: 'linked', taskCount: 1, completedCount: 1 })
  })

  it('ignores ordinary agent conversations', () => {
    const agent = { ...createEmptyThread({ mode: 'agent', origin: 'user' }), id: 'agent' }
    agent.messages = [{ id: 'user', role: 'user', content: 'ordinary task', timestamp: 1 }]
    expect(projectPlanHistory([], { agent })).toEqual([])
  })
})
