import { describe, expect, it } from 'vitest'
import { buildExecutionBatches, canToolCallRunInParallel } from '@/renderer/agent/core/toolExecutionPlan'
import type { ToolCall } from '@/shared/types'

const call = (id: string, parallel: boolean): ToolCall => ({
  id,
  name: 'task',
  arguments: { description: id, prompt: id, parallel },
  status: 'pending',
})

describe('task tool execution planning', () => {
  it('honors the task parallel argument', () => {
    expect(canToolCallRunInParallel(call('parallel', true))).toBe(true)
    expect(canToolCallRunInParallel(call('serial', false))).toBe(false)
  })

  it('batches independent sub-agents together', () => {
    const batches = buildExecutionBatches([call('one', true), call('two', true)])
    expect(batches).toHaveLength(1)
    expect(batches[0].parallel).toBe(true)
    expect(batches[0].toolCalls.map(item => item.id)).toEqual(['one', 'two'])
  })
})
