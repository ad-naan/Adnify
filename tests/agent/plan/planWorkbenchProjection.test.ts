import { describe, expect, it } from 'vitest'
import { planReviewRiskParams, projectPlanReview, projectPlanWorkbench } from '@/renderer/agent/plan/planWorkbenchProjection'
import { createEmptyThread } from '@/renderer/agent/store/slices/threadSlice'
import type { TaskPlan } from '@/renderer/agent/plan/types'
import { t } from '@shared/i18n'

function thread(id: string) {
  return { ...createEmptyThread(), id }
}

type WorkbenchInput = Parameters<typeof projectPlanWorkbench>[0]

/** 默认按中文投影，断言里读到的就是 `zh` 表里的工具标题；语言相关的用例自己传 `language`。 */
function project(input: Omit<WorkbenchInput, 'language'> & Partial<Pick<WorkbenchInput, 'language'>>) {
  return projectPlanWorkbench({ language: 'zh', ...input })
}

describe('projectPlanWorkbench', () => {
  it('does not invent an empty workflow state', () => {
    const result = project({ currentThreadId: null, threads: {} })
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

    const result = project({ currentThreadId: root.id, threads: { root } })
    expect(result.focus?.title).toBe('核对导航约束')
    expect(result.focus?.detail).toContain('保持可切换')
    expect(result.focus?.progress).toBe(30)
  })

  it('projects live tool calls without waiting for an AI activity report', () => {
    const root = thread('root')
    root.streamState = {
      phase: 'tool_running',
      currentToolCall: { id: 'read-1', name: 'read_file', arguments: { path: 'src/main.ts' }, status: 'running' },
    }
    root.messages = [{
      id: 'assistant-1', role: 'assistant', content: '', timestamp: 10, parts: [],
      toolCalls: [{ id: 'read-1', name: 'read_file', arguments: { path: 'src/main.ts' }, status: 'running' }],
    }]

    const result = project({ currentThreadId: root.id, threads: { root } })
    expect(result.isProcessing).toBe(true)
    expect(result.focus).toMatchObject({ title: '读取文件', detail: 'src/main.ts', tone: 'active' })
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

    const result = project({ plan, currentThreadId: root.id, threads: { root, worker } })
    expect(result.stage).toBe('execution')
    expect(result.approvals).toHaveLength(1)
    expect(result.approvals[0].requestId).toBe('request-1')
    expect(result.focus?.title).toBe('运行验证')
  })

  it('projects nested sub-agent runtime and approval state from real task metadata', () => {
    const root = thread('root')
    const worker = thread('worker')
    const child = thread('child')
    worker.messages = [{
      id: 'worker-assistant', role: 'assistant', content: '', timestamp: 10, parts: [],
      toolCalls: [{
        id: 'sub-agent-tool', name: 'task', status: 'running',
        arguments: {
          description: '检查渲染回归',
          _meta: { subAgentThreadId: child.id, subAgentStartedAt: 100 },
        },
      }],
    }]
    child.streamState = {
      phase: 'tool_pending', requestId: 'child-approval', statusText: '等待运行测试',
      currentToolCall: { id: 'child-command', name: 'run_command', status: 'pending', arguments: { command: 'pnpm test' } },
    }
    const plan: TaskPlan = {
      id: 'plan-1', name: 'Nested runtime', createdAt: 1, updatedAt: 1,
      requirementsDoc: 'plan-1.md', executionMode: 'parallel', status: 'executing', originThreadId: root.id,
      tasks: [{ id: 'task-1', title: '前端验证', description: '验证界面', provider: 'openai', model: 'test', role: 'tester', dependencies: [], status: 'running', threadId: worker.id }],
    }

    const result = project({ plan, currentThreadId: root.id, threads: { root, worker, child } })
    expect(result.tasks[0].subAgents).toEqual([expect.objectContaining({
      description: '检查渲染回归',
      threadId: 'child',
      status: 'waiting_approval',
      currentToolName: 'run_command',
      requestId: 'child-approval',
    })])
  })

  it('keeps the original request instead of reducing it to a clarification reply', () => {
    const root = thread('root')
    root.messages = [
      { id: 'request', role: 'user', content: '重构 Plan 模式的任务编排', timestamp: 10 },
      { id: 'question', role: 'assistant', content: '你希望先处理哪部分？', timestamp: 20, parts: [] },
      { id: 'reply', role: 'user', content: '1', timestamp: 30 },
    ]

    const result = project({ currentThreadId: root.id, threads: { root } })
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

    const result = project({ plan, currentThreadId: root.id, threads: { root } })
    expect(result.requestText).toBe('重新设计计划工作台')
  })

  it('derives review metrics, allocations, and write conflicts from plan data', () => {
    const base = { provider: 'openai', model: 'gpt-test', role: 'engineer', status: 'pending' as const }
    const plan: TaskPlan = {
      id: 'review-plan', name: 'Review', createdAt: 1, updatedAt: 1, requirementsDoc: 'review.md', executionMode: 'parallel', status: 'draft',
      tasks: [
        { ...base, id: 'root', title: 'Root', description: 'Root', dependencies: [], estimatedTokens: 100 },
        { ...base, id: 'left', title: 'Left', description: 'Left', dependencies: ['root'], producesFiles: ['shared.ts'], estimatedTokens: 200 },
        { ...base, id: 'right', title: 'Right', description: 'Right', dependencies: ['root'], producesFiles: ['shared.ts'], estimatedTokens: 300 },
      ],
    }

    const review = projectPlanReview(plan)
    expect(review.taskCount).toBe(3)
    expect(review.maxParallelism).toBe(2)
    expect(review.estimatedTokens).toBe(600)
    expect(review.allocations).toEqual([{ key: 'engineer\u0000openai\u0000gpt-test', role: 'engineer', provider: 'openai', model: 'gpt-test', taskCount: 3 }])
    expect(review.risks.map(risk => risk.id)).toContain('write-conflict:1:shared.ts')
  })

  /**
   * 风险只带原因码和参数，句子由渲染层拼。
   *
   * 这里同时钉住两件事：投影里不出现用户可见文案（否则又要给每种语言加字段），
   * 以及任务标题列表按语言连接 —— 中文用顿号、英文用 "and"，写死一个分隔符两边都别扭。
   */
  it('reports review risks as reason codes whose copy both locales can render', () => {
    const base = { provider: 'openai', model: 'gpt-test', role: 'engineer', status: 'pending' as const }
    const plan: TaskPlan = {
      id: 'risk-plan', name: 'Risks', createdAt: 1, updatedAt: 1, requirementsDoc: 'risk.md', executionMode: 'parallel', status: 'draft',
      tasks: [
        { ...base, id: 'left', title: 'Left', description: 'Left', dependencies: [], producesFiles: ['shared.ts'] },
        { ...base, id: 'right', title: 'Right', description: 'Right', dependencies: [], producesFiles: ['shared.ts'] },
        { ...base, id: 'orphan', title: 'Orphan', description: 'Orphan', dependencies: ['ghost'] },
      ],
    }

    const risks = projectPlanReview(plan).risks
    expect(risks.map(risk => risk.code).sort()).toEqual(['missingDependency', 'parallelWriteConflict'])
    expect(JSON.stringify(risks)).not.toMatch(/[一-龥]/)

    const missing = risks.find(risk => risk.code === 'missingDependency')!
    expect(t('planReview.risk.missingDependency.detail', 'zh', planReviewRiskParams(missing, 'zh'))).toContain('1 个依赖引用')

    const conflict = risks.find(risk => risk.code === 'parallelWriteConflict')!
    expect(t('planReview.risk.parallelWriteConflict.detail', 'zh', planReviewRiskParams(conflict, 'zh'))).toBe('Left和Right 可能在同一调度层写入 shared.ts。')
    expect(t('planReview.risk.parallelWriteConflict.detail', 'en', planReviewRiskParams(conflict, 'en'))).toBe('Left and Right may write shared.ts in the same scheduling layer.')
  })

  it('translates activity titles and file lists with the requested language', () => {
    const root = thread('root')
    root.messages = [{
      id: 'assistant-1', role: 'assistant', content: '', timestamp: 10, parts: [],
      toolCalls: [{ id: 'read-1', name: 'read_files', status: 'success', arguments: { paths: ['a.ts', 'b.ts'] } }],
    }]

    expect(project({ currentThreadId: root.id, threads: { root }, language: 'en' }).activities[0])
      .toMatchObject({ title: 'Reading files', detail: 'a.ts, b.ts' })
    expect(project({ currentThreadId: root.id, threads: { root }, language: 'zh' }).activities[0])
      .toMatchObject({ title: '读取文件', detail: 'a.ts、b.ts' })
  })

  // Thread scans are cached by `messages` array identity so streaming does not
  // re-walk every plan thread ~30×/s. These pin the invalidation contract: a new
  // array must be observed, and a reused array must not go stale for the fields
  // that live outside `messages`.
  it('picks up new messages through the per-thread scan cache', () => {
    const root = thread('root')
    root.messages = [{
      id: 'assistant-1', role: 'assistant', content: '', timestamp: 10, parts: [],
      toolCalls: [{ id: 'read-1', name: 'read_file', status: 'success', arguments: { path: 'first.ts' } }],
    }]

    const first = project({ currentThreadId: root.id, threads: { root } })
    expect(first.activities.map(activity => activity.detail)).toEqual(['first.ts'])

    // Same thread id, new messages array — exactly what a streaming flush produces.
    const grown = {
      ...root,
      messages: [...root.messages, {
        id: 'assistant-2', role: 'assistant' as const, content: '', timestamp: 20, parts: [],
        toolCalls: [{ id: 'read-2', name: 'read_file', status: 'success' as const, arguments: { path: 'second.ts' } }],
      }],
    }
    const second = project({ currentThreadId: root.id, threads: { root: grown } })
    expect(second.activities.map(activity => activity.detail)).toEqual(['first.ts', 'second.ts'])
  })

  it('still reflects streamState changes when the messages array is reused', () => {
    const root = thread('root')
    root.messages = [{
      id: 'assistant-1', role: 'assistant', content: '', timestamp: 10, parts: [],
      toolCalls: [{ id: 'read-1', name: 'read_file', status: 'running', arguments: { path: 'src/main.ts' } }],
    }]

    const idle = project({ currentThreadId: root.id, threads: { root } })
    expect(idle.isProcessing).toBe(false)

    // Only streamState changes; `messages` keeps its identity and stays cached.
    const live = {
      ...root,
      streamState: {
        phase: 'tool_running' as const,
        currentToolCall: { id: 'read-1', name: 'read_file', arguments: { path: 'src/main.ts' }, status: 'running' as const },
      },
    }
    const running = project({ currentThreadId: root.id, threads: { root: live } })
    expect(running.isProcessing).toBe(true)
    expect(running.focus).toMatchObject({ title: '读取文件', detail: 'src/main.ts' })
  })
})
