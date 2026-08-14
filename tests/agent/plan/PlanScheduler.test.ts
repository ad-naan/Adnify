import { describe, expect, it } from 'vitest'
import { ExecutionScheduler } from '@/renderer/agent/plan/PlanScheduler'
import type { PlanTask, TaskPlan } from '@/renderer/agent/plan/types'

const task = (id: string, overrides: Partial<PlanTask> = {}): PlanTask => ({
    id,
    title: id,
    description: id,
    provider: 'openai',
    model: 'test',
    role: 'default',
    dependencies: [],
    status: 'pending',
    ...overrides,
})

const plan = (tasks: PlanTask[]): TaskPlan => ({
    id: 'plan-1',
    name: 'Plan',
    createdAt: 1,
    updatedAt: 1,
    requirementsDoc: 'requirements.md',
    executionMode: 'parallel',
    status: 'executing',
    tasks,
})

describe('ExecutionScheduler parallel refill', () => {
    it('keeps free slots available while another task is still running', () => {
        const scheduler = new ExecutionScheduler({ maxConcurrency: 2 })
        const first = task('first', { executionClass: 'approval-heavy' })
        const second = task('second', { executionClass: 'analysis-read-heavy' })
        const third = task('third', { executionClass: 'analysis-read-heavy' })
        const currentPlan = plan([first, second, third])

        scheduler.start()
        scheduler.markTaskRunning(first)

        const batch = scheduler.getParallelBatch(currentPlan)
        expect(batch).toHaveLength(1)
        expect(batch[0].id).toBe('second')
    })

    it('does not start work beside an active write-heavy task', () => {
        const scheduler = new ExecutionScheduler({ maxConcurrency: 3 })
        const writer = task('writer', { executionClass: 'write-heavy' })
        const reader = task('reader', { executionClass: 'analysis-read-heavy' })
        const currentPlan = plan([writer, reader])

        scheduler.start()
        scheduler.markTaskRunning(writer)

        expect(scheduler.getParallelBatch(currentPlan)).toEqual([])
    })

    it('prevents a write-heavy task from joining active read work', () => {
        const scheduler = new ExecutionScheduler({ maxConcurrency: 3 })
        const reader = task('reader', { executionClass: 'analysis-read-heavy' })
        const writer = task('writer', { executionClass: 'write-heavy', priority: 10 })
        const currentPlan = plan([reader, writer])

        scheduler.start()
        scheduler.markTaskRunning(reader)

        expect(scheduler.getParallelBatch(currentPlan).map(item => item.id)).not.toContain('writer')
    })
})
