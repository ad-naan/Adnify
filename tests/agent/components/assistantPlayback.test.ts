import { describe, expect, it } from 'vitest'
import type { AssistantPart, ToolCall } from '@renderer/agent/types'
import {
  buildPlayableText,
  buildVisibleTimeline,
  decidePlaybackFrontierAction,
  findPlaybackFrontier,
} from '@renderer/components/agent/useAssistantPlayback'

function reasoning(content: string, isStreaming: boolean): AssistantPart {
  return { id: 'reasoning-1', type: 'reasoning', content, isStreaming }
}

function text(content: string): AssistantPart {
  return { type: 'text', content }
}

function tool(status: ToolCall['status']): AssistantPart {
  return {
    type: 'tool_call',
    toolCall: { id: 'tool-1', name: 'read_file', arguments: {}, status },
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
})
