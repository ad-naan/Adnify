import { describe, expect, it, beforeEach, vi } from 'vitest'

vi.mock('@/renderer/services/electronAPI', () => ({
  api: {
    file: {
      exists: vi.fn(async () => true),
      delete: vi.fn(async () => undefined),
      write: vi.fn(async () => undefined),
      read: vi.fn(async () => null),
      readDir: vi.fn(async () => []),
      mkdir: vi.fn(async () => undefined),
    },
  },
}))

vi.mock('@store', () => ({
  useStore: { getState: () => ({ workspacePath: '/ws', language: 'en' }) },
}))

import { api } from '@/renderer/services/electronAPI'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import type { TaskPlan } from '@/renderer/agent/plan/types'

function makePlan(id: string, taskThreadIds: string[]): TaskPlan {
  return {
    id,
    name: `plan ${id}`,
    createdAt: 1,
    updatedAt: 2,
    requirementsDoc: `${id}.md`,
    executionMode: 'sequential',
    status: 'completed',
    tasks: taskThreadIds.map((threadId, index) => ({
      id: `${id}-task-${index}`,
      title: 'task',
      description: 'task',
      provider: 'openai',
      model: 'test',
      role: 'worker',
      dependencies: [],
      status: 'completed' as const,
      threadId,
    })),
  }
}

describe('deletePlan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAgentStore.setState({ plans: [], activePlanId: null, currentTaskId: null })
  })

  it('removes the plan from state and deletes both of its files', async () => {
    const store = useAgentStore.getState()
    store.addPlan(makePlan('p1', []))
    expect(useAgentStore.getState().plans).toHaveLength(1)

    useAgentStore.getState().deletePlan('p1')

    expect(useAgentStore.getState().plans).toHaveLength(0)
    // activePlanId was pointing at the deleted plan.
    expect(useAgentStore.getState().activePlanId).toBeNull()

    // The async file cleanup is fire-and-forget; let it settle.
    await vi.waitFor(() => {
      expect(api.file.delete).toHaveBeenCalledWith('/ws/.adnify/plan/p1.json')
      expect(api.file.delete).toHaveBeenCalledWith('/ws/.adnify/plan/p1.md')
    })
  })

  it('cascades to the hidden plan-task threads it spawned', () => {
    const store = useAgentStore.getState()
    const workerA = store.createThread({ activate: false, mode: 'plan', origin: 'plan-task', planId: 'p2', taskId: 't0' })
    const workerB = store.createThread({ activate: false, mode: 'plan', origin: 'plan-task', planId: 'p2', taskId: 't1' })
    // A worker belonging to a DIFFERENT plan must survive.
    const otherWorker = store.createThread({ activate: false, mode: 'plan', origin: 'plan-task', planId: 'p9', taskId: 't0' })

    useAgentStore.getState().addPlan(makePlan('p2', [workerA, workerB]))
    useAgentStore.getState().deletePlan('p2')

    const threads = useAgentStore.getState().threads
    expect(threads[workerA]).toBeUndefined()
    expect(threads[workerB]).toBeUndefined()
    expect(threads[otherWorker]).toBeDefined()
  })

  it('leaves other plans untouched', () => {
    const store = useAgentStore.getState()
    store.addPlan(makePlan('keep', []))
    store.addPlan(makePlan('drop', []))

    useAgentStore.getState().deletePlan('drop')

    expect(useAgentStore.getState().plans.map(p => p.id)).toEqual(['keep'])
  })
})
