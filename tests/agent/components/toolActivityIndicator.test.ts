import { describe, expect, it } from 'vitest'
import type { ToolCall } from '@/renderer/agent/types'
import { getToolTiming } from '@/renderer/components/agent/ToolActivityIndicator'

function toolCall(meta?: Record<string, unknown>): ToolCall {
  return {
    id: 'tool-1',
    name: 'run_command',
    status: 'success',
    arguments: meta ? { _meta: meta } : {},
  }
}

describe('getToolTiming', () => {
  it('reads persisted start and duration metadata', () => {
    expect(getToolTiming(toolCall({ startedAt: 1000, durationMs: 2450 }))).toEqual({
      startedAt: 1000,
      durationMs: 2450,
    })
  })

  it('ignores malformed timing values from older conversations', () => {
    expect(getToolTiming(toolCall({ startedAt: 'now', durationMs: Number.NaN }))).toEqual({
      startedAt: undefined,
      durationMs: undefined,
    })
  })
})
