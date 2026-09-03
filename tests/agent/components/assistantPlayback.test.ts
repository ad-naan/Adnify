import { describe, expect, it } from 'vitest'
import type { AssistantPart, ToolCall } from '@renderer/agent/types'
import {
  buildPlayableText,
  buildVisibleTimeline,
  decidePlaybackFrontierAction,
  decidePlaybackReleaseOutcome,
  findNextPlaybackFrontier,
  findPlaybackFrontier,
  findPresentingToolId,
} from '@renderer/components/agent/useAssistantPlayback'

function reasoning(content: string, isStreaming: boolean): AssistantPart {
  return { id: 'reasoning-1', type: 'reasoning', content, isStreaming }
}

function text(content: string): AssistantPart {
  return { type: 'text', content }
}

function tool(status: ToolCall['status'], id = 'tool-1'): AssistantPart {
  return {
    type: 'tool_call',
    toolCall: { id, name: 'read_file', arguments: {}, status },
  }
}

describe('assistant playback timeline', () => {
  it('stops the playable tape at a streaming thought', () => {
    const parts = [
      reasoning('think', true),
      text('final answer'),
    ]
    const frontier = findPlaybackFrontier(parts)

    expect(frontier).toBe(0)
    expect(buildPlayableText(parts, frontier)).toBe('think')
  })

  it('does not mount a later tool until preceding text has drained', () => {
    const parts = [text('intro'), tool('running'), text('answer')]
    const frontier = findPlaybackFrontier(parts)

    const partial = buildVisibleTimeline(parts, frontier, 3, true)
    expect(partial.bySource.get(parts[0])).toMatchObject({ content: 'int' })
    expect(partial.bySource.has(parts[1])).toBe(false)

    const drained = buildVisibleTimeline(parts, frontier, 5, true)
    expect(drained.bySource.get(parts[0])).toMatchObject({ content: 'intro' })
    expect(drained.bySource.get(parts[1])).toBe(parts[1])
    expect(drained.bySource.has(parts[2])).toBe(false)
  })

  it('starts final text only after thought and tool barriers settle', () => {
    const activeParts = [reasoning('think', true), tool('running'), text('answer')]
    expect(buildPlayableText(activeParts, findPlaybackFrontier(activeParts))).toBe('think')

    const settledParts = [reasoning('think', false), tool('success'), text('answer')]
    const frontier = findPlaybackFrontier(settledParts)
    expect(buildPlayableText(settledParts, frontier)).toBe('thinkanswer')

    const firstReplyGlyph = buildVisibleTimeline(settledParts, frontier, 6, false)
    expect(firstReplyGlyph.bySource.get(settledParts[2])).toMatchObject({ content: 'a' })
    expect(firstReplyGlyph.activeSource).toBe(settledParts[2])
  })

  it('preserves original part order in the visible map', () => {
    const parts = [text('one'), tool('success'), reasoning('two', false), text('three')]
    const frontier = findPlaybackFrontier(parts)
    const frame = buildVisibleTimeline(parts, frontier, 11, false)

    expect(parts.filter(part => frame.bySource.has(part))).toEqual(parts)
    expect(frame.bySource.get(parts[0])).toMatchObject({ content: 'one' })
    expect(frame.bySource.get(parts[2])).toMatchObject({ content: 'two' })
    expect(frame.bySource.get(parts[3])).toMatchObject({ content: 'three' })
  })

  it('remembers a completed barrier when its successor arrives later', () => {
    expect(decidePlaybackFrontierAction({
      sourceFrontier: 0,
      releasedFrontier: 0,
      activeBarrier: -1,
      completedBarrier: true,
      frontierDrained: true,
    })).toBe('wait-for-successor')

    expect(decidePlaybackFrontierAction({
      sourceFrontier: 1,
      releasedFrontier: 0,
      activeBarrier: -1,
      completedBarrier: true,
      frontierDrained: true,
    })).toBe('collapse-current')
  })

  it('drains visible text before starting the collapse window', () => {
    expect(decidePlaybackFrontierAction({
      sourceFrontier: 2,
      releasedFrontier: 0,
      activeBarrier: 2,
      completedBarrier: true,
      frontierDrained: false,
    })).toBe('drain-current')
  })

  it('releases adjacent completed tools one visual stage at a time', () => {
    const parts = [tool('success', 'tool-1'), tool('success', 'tool-2'), text('answer')]

    expect(findNextPlaybackFrontier(parts, -1, 2)).toBe(0)
    expect(findNextPlaybackFrontier(parts, 0, 2)).toBe(1)
    expect(findNextPlaybackFrontier(parts, 1, 2)).toBe(2)
  })

  it('coalesces plain text with the next visual stage', () => {
    const parts = [text('intro'), tool('success'), text('answer')]

    expect(findNextPlaybackFrontier(parts, -1, 2)).toBe(1)
    expect(findNextPlaybackFrontier(parts, 1, 2)).toBe(2)
  })

  it('presents only the current live or settling tool', () => {
    const runningParts = [tool('running')]
    const settledParts = [tool('success')]

    expect(findPresentingToolId(runningParts, 0, null)).toBe('tool-1')
    expect(findPresentingToolId(settledParts, 0, 0)).toBe('tool-1')
    expect(findPresentingToolId(settledParts, 0, null)).toBeUndefined()
  })

  it('does not present a tool when the playback frontier is out of bounds', () => {
    const parts = [tool('running')]

    expect(findPresentingToolId([], -1, null)).toBeUndefined()
    expect(findPresentingToolId(parts, -1, null)).toBeUndefined()
    expect(findPresentingToolId(parts, parts.length, null)).toBeUndefined()
  })
})

/**
 * 节拍的另一半：呈现中的阶段什么时候松手。
 *
 * 松手就是让那一行收起，而收起最后一行会让钉在底部的时间轴把整屏内容往下拽。所以只有在
 * "有后继行能同时挂载"或"回合已经结束"时才允许。
 */
describe('playback release outcome', () => {
  const decide = (overrides: Partial<Parameters<typeof decidePlaybackReleaseOutcome>[0]> = {}) =>
    decidePlaybackReleaseOutcome({ hasPendingSuccessor: false, isTransportActive: false, ...overrides })

  it('hands off to the successor stage as soon as one is queued', () => {
    expect(decide({ hasPendingSuccessor: true, isTransportActive: true })).toBe('publish-successor')
    expect(decide({ hasPendingSuccessor: true })).toBe('publish-successor')
  })

  it('keeps holding the presented stage while the turn is still running', () => {
    // 模型在两次工具之间想事情：这一行是当前阶段，没有东西能接手它的收起。
    expect(decide({ isTransportActive: true })).toBe('retain-settling')
  })

  it('lets go once the turn is over', () => {
    expect(decide({})).toBe('clear-settling')
  })
})
