import { describe, expect, it } from 'vitest'
import { projectPlanWorkbench } from '@/renderer/agent/plan/planWorkbenchProjection'
import { createEmptyThread } from '@/renderer/agent/store/slices/threadSlice'
import type { TaskPlan } from '@/renderer/agent/plan/types'

function thread(id: string) {
  return { ...createEmptyThread(), id }
}

describe('projectPlanWorkbench', () => {
  it('does not invent an empty workflow state', () => {
    const result = projectPlanWorkbench({ currentThreadId: null, threads: {} })
    expect(result.hasSession).toBe(false)
    expect(result.focus).toBeNull()
  })

  it('uses AI-reported fine-grained activity as the current focus', () => {
    const root = thread('root')
    root.messages = [{
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      timestamp: 10,
      parts: [],
      toolCalls: [{
        id: 'activity-1',
        name: 'report_plan_activity',
        status: 'success',
        arguments: { stage: 'requirements', title: '核对导航约束', detail: '发现计划看板必须保持可切换。', progress: 30 },
      }],
    }]

    const result = projectPlanWorkbench({ currentThreadId: root.id, threads: { root } })
    expect(result.focus?.title).toBe('核对导航约束')
    expect(result.focus?.detail).toContain('保持可切换')
    expect(result.focus?.progress).toBe(30)
  })

  it('aggregates task threads by plan ownership and exposes approvals', () => {
    const root = thread('root')
    const worker = thread('worker')
    worker.planId = 'plan-1'
    worker.taskId = 'task-1'
    worker.origin = 'plan-task'
    worker.streamState = {
      phase: 'tool_pending',
      requestId: 'request-1',
      currentToolCall: { id: 'tool-1', name: 'run_command', arguments: { command: 'npm test' }, status: 'pending' },
    }
    const plan: TaskPlan = {
      id: 'plan-1',
      name: 'Plan workbench',
      createdAt: 1,
      updatedAt: 1,
      requirementsDoc: 'plan-1.md',
      executionMode: 'parallel',
      status: 'executing',
      originThreadId: root.id,
      tasks: [{ id: 'task-1', title: '运行验证', description: '执行测试', provider: 'openai', model: 'test', role: 'tester', dependencies: [], status: 'running', threadId: worker.id }],
    }

    const result = projectPlanWorkbench({ plan, currentThreadId: root.id, threads: { root, worker } })
    expect(result.stage).toBe('execution')
    expect(result.approvals).toHaveLength(1)
    expect(result.approvals[0].requestId).toBe('request-1')
    expect(result.focus?.title).toBe('运行验证')
  })

  it('keeps the original request instead of reducing it to a clarification reply', () => {
    const root = thread('root')
    root.messages = [
      { id: 'request', role: 'user', content: '重构 Plan 模式的任务编排', timestamp: 10 },
      { id: 'question', role: 'assistant', content: '你希望先处理哪部分？', timestamp: 20, parts: [] },
      { id: 'reply', role: 'user', content: '1', timestamp: 30 },
    ]

    const result = projectPlanWorkbench({ currentThreadId: root.id, threads: { root } })
    expect(result.requestText).toBe('重构 Plan 模式的任务编排')
    expect(result.requestTimestamp).toBe(10)
  })

  it('uses the request persisted with an existing plan', () => {
    const root = thread('root')
    const plan: TaskPlan = {
      id: 'plan-1',
      name: 'Plan workbench',
      userRequest: '重新设计计划工作台',
      createdAt: 1,
      updatedAt: 1,
      requirementsDoc: 'plan-1.md',
      executionMode: 'sequential',
      status: 'draft',
      originThreadId: root.id,
      tasks: [],
    }

    const result = projectPlanWorkbench({ plan, currentThreadId: root.id, threads: { root } })
    expect(result.requestText).toBe('重新设计计划工作台')
  })
})
