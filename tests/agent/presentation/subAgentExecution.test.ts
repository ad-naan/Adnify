import { describe, expect, it } from 'vitest'
import { buildSubAgentExecutionSteps } from '@/renderer/agent/presentation/subAgentExecution'

describe('buildSubAgentExecutionSteps', () => {
  it('shows the real running stage and current tool', () => {
    const steps = buildSubAgentExecutionSteps({
      language: 'en',
      hasThread: true,
      isRunning: true,
      isSuccess: false,
      isError: false,
      waitingApproval: false,
      currentToolName: 'read_file',
      completedToolCount: 2,
    })

    expect(steps.map(step => step.state)).toEqual(['complete', 'active', 'pending'])
    expect(steps[1].detail).toContain('read_file')
  })

  it('represents approval as a waiting state instead of fake progress', () => {
    const steps = buildSubAgentExecutionSteps({
      language: 'zh',
      hasThread: true,
      isRunning: true,
      isSuccess: false,
      isError: false,
      waitingApproval: true,
      completedToolCount: 1,
    })

    expect(steps[1]).toMatchObject({ state: 'waiting', detail: '等待你批准下一项操作' })
    expect(steps[2].state).toBe('pending')
  })

  it('completes all stages only after the result returns', () => {
    const steps = buildSubAgentExecutionSteps({
      language: 'en',
      hasThread: true,
      isRunning: false,
      isSuccess: true,
      isError: false,
      waitingApproval: false,
      completedToolCount: 4,
    })

    expect(steps.every(step => step.state === 'complete')).toBe(true)
  })

  it('marks both execution and reporting when a child task fails', () => {
    const steps = buildSubAgentExecutionSteps({
      language: 'en',
      hasThread: true,
      isRunning: false,
      isSuccess: false,
      isError: true,
      waitingApproval: false,
      completedToolCount: 0,
    })

    expect(steps.map(step => step.state)).toEqual(['complete', 'error', 'error'])
  })

  it('does not mark a received brief as failed when startup metadata is missing', () => {
    const steps = buildSubAgentExecutionSteps({
      language: 'zh',
      hasThread: false,
      isRunning: false,
      isSuccess: false,
      isError: true,
      waitingApproval: false,
      completedToolCount: 0,
    })

    expect(steps[0]).toMatchObject({ state: 'complete', detail: '上下文已交给子代理' })
  })
})
