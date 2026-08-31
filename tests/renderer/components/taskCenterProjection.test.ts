import { describe, expect, it } from 'vitest'
import { createEmptyThread } from '@/renderer/agent/store/slices/threadSlice'
import type { ChatThread } from '@/renderer/agent/types'
import type { TaskPlan } from '@/renderer/agent/plan/types'
import { flattenTaskNodes, isAgentTaskThread, projectTaskCenter } from '@/renderer/components/agent/taskCenterProjection'

function thread(id: string, updates: Partial<ChatThread> = {}): ChatThread {
  return {
    ...createEmptyThread(),
    id,
    createdAt: Number(id.replace(/\D/g, '')) || 1,
    lastModified: Number(id.replace(/\D/g, '')) || 1,
    title: id,
    ...updates,
  }
}

describe('projectTaskCenter', () => {
  it('keeps Plan-owned threads out of the Agent task center', () => {
    expect(isAgentTaskThread(thread('agent1', { mode: 'agent', origin: 'user' }))).toBe(true)
    expect(isAgentTaskThread(thread('planner2', { mode: 'plan', origin: 'user' }))).toBe(false)
    expect(isAgentTaskThread(thread('worker3', { mode: 'agent', origin: 'plan-task' }))).toBe(false)
  })

  it('keeps handoffs and sub-agents under the original task lineage', () => {
    const root = thread('root1', { origin: 'user' })
    const handoff = thread('handoff2', {
      origin: 'handoff',
      parentThreadId: root.id,
      rootThreadId: root.id,
      handoffResume: { sourceThreadId: root.id, createdAt: 2 },
    })
    const child = thread('child3', {
      origin: 'sub-agent',
      parentThreadId: handoff.id,
      rootThreadId: root.id,
      streamState: { phase: 'tool_pending' },
    })

    const groups = projectTaskCenter({ root1: root, handoff2: handoff, child3: child }, [], {})

    expect(groups).toHaveLength(1)
    expect(groups[0].status).toBe('waiting')
    const nodes = flattenTaskNodes(groups[0].nodes)
    expect(nodes.map(node => [node.id, node.relation, node.depth])).toEqual([
      ['root1', 'root', 0],
      ['handoff2', 'continuation', 1],
      ['child3', 'subtask', 2],
    ])
  })

  it('groups plan workers by plan instead of showing them as unrelated conversations', () => {
    const worker = thread('worker1', {
      origin: 'plan-task',
      planId: 'plan-1',
      taskId: 'task-1',
      streamState: { phase: 'streaming' },
    })
    const plan: TaskPlan = {
      id: 'plan-1',
      name: 'Release readiness',
      createdAt: 1,
      updatedAt: 2,
      requirementsDoc: 'requirements.md',
      executionMode: 'parallel',
      status: 'executing',
      tasks: [{
        id: 'task-1',
        title: 'Run checks',
        description: 'Run the release checks',
        provider: 'test',
        model: 'test',
        role: 'default',
        dependencies: [],
        status: 'running',
        threadId: worker.id,
      }],
    }

    const groups = projectTaskCenter({ worker1: worker }, [plan], {})

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ kind: 'plan', title: 'Release readiness', status: 'running' })
    expect(groups[0].nodes[0]).toMatchObject({ relation: 'plan-task', threadId: 'worker1' })
  })

  it('reports conversation branches on their owning execution node', () => {
    const root = thread('root1')
    const groups = projectTaskCenter({ root1: root }, [], {
      root1: [
        { id: '__mainline__', name: 'main', forkFromMessageId: 'm1', createdAt: 1, messages: [], isActive: false },
        { id: 'alternative', name: 'Alternative', forkFromMessageId: 'm1', createdAt: 2, messages: [], isActive: true },
      ],
    })

    expect(groups[0].nodes[0].branchCount).toBe(1)
  })
})
