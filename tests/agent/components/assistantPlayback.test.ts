import { describe, expect, it } from 'vitest'
import type { AssistantPart, ToolCall } from '@renderer/agent/types'
import {
  buildPlayableText,
  buildVisibleTimeline,
  countPendingStages,
  decidePlaybackFrontierAction,
  decidePlaybackPacing,
  decidePlaybackReleaseOutcome,
  findNextPlaybackFrontier,
  findPlaybackFrontier,
  findPresentingToolIds,
} from '@renderer/components/agent/useAssistantPlayback'
import { AGENT_PLAYBACK_MAX_STAGE_BACKLOG } from '@renderer/agent/presentation/disclosureMotion'

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

    expect(findPresentingToolIds(runningParts, 0, null)).toEqual(['tool-1'])
    expect(findPresentingToolIds(settledParts, 0, 0)).toEqual(['tool-1'])
    expect(findPresentingToolIds(settledParts, 0, null)).toEqual([])
  })

  it('does not present a tool when the playback frontier is out of bounds', () => {
    const parts = [tool('running')]

    expect(findPresentingToolIds([], -1, null)).toEqual([])
    expect(findPresentingToolIds(parts, -1, null)).toEqual([])
    expect(findPresentingToolIds(parts, parts.length, null)).toEqual([])
  })
})

/**
 * 并发：模型一条消息里发好几个工具调用时，它们在真实世界里同时在跑。
 *
 * 一拍放一个的话，界面在说"它们排着队"，而状态托盘里早就列出了后面那几个工具改的文件 ——
 * 界面自己打自己的脸。所以一整批算一个阶段：一起挂载、一起入场、一起被按住。
 */
describe('concurrent tool batches', () => {
  it('opens the whole live batch as one stage', () => {
    const parts = [
      text('intro'),
      tool('running', 'tool-1'),
      tool('pending', 'tool-2'),
      tool('running', 'tool-3'),
    ]

    expect(findPlaybackFrontier(parts)).toBe(3)
    expect(findNextPlaybackFrontier(parts, 0, 3)).toBe(3)
    expect(countPendingStages(parts, 0, 3)).toBe(1)
  })

  it('keeps a batch member that already returned inside the batch', () => {
    // 前一个还没跑完，后一个就返回了 —— 这本身就说明它们是并发的。
    const parts = [tool('running', 'tool-1'), tool('success', 'tool-2'), tool('running', 'tool-3')]

    expect(findPlaybackFrontier(parts)).toBe(2)
    expect(findPresentingToolIds(parts, 2, null)).toEqual(['tool-1', 'tool-2', 'tool-3'])
  })

  it('does not drag a previous sequential row into the current batch', () => {
    // 顺序执行：上一拍那行早已落定，重新拉进来会让它重播入场动画、并被按住不许收起。
    const parts = [tool('success', 'tool-1'), tool('running', 'tool-2')]

    expect(findPlaybackFrontier(parts)).toBe(1)
    expect(findPresentingToolIds(parts, 1, null)).toEqual(['tool-2'])
  })

  it('narrows the presented batch to the hand-off row once everything settles', () => {
    const parts = [tool('success', 'tool-1'), tool('success', 'tool-2')]

    expect(findPresentingToolIds(parts, 1, 1)).toEqual(['tool-2'])
  })

  it('still walks a settled history one stage at a time', () => {
    const parts = [tool('success', 'tool-1'), tool('success', 'tool-2'), text('answer')]

    expect(findPlaybackFrontier(parts)).toBe(2)
    expect(findNextPlaybackFrontier(parts, -1, 2)).toBe(0)
    expect(countPendingStages(parts, -1, 2)).toBe(2)
  })

  it('leaves a non-tool barrier alone', () => {
    const parts = [reasoning('think', true), tool('running'), text('answer')]

    expect(findPlaybackFrontier(parts)).toBe(0)
  })
})

/**
 * 落后量的上限。
 *
 * 托盘里的待处理改动来自工具**结果**，一落地就写进 store —— 它天生跑在按节拍重放的时间轴前面。
 * 差到两个阶段就不再等节拍；用户被审批卡着时更不能等，那一行就是他要点的东西。
 */
describe('playback pacing', () => {
  const decide = (overrides: Partial<Parameters<typeof decidePlaybackPacing>[0]> = {}) =>
    decidePlaybackPacing({ backlog: 0, isAwaitingApproval: false, ...overrides })

  it('keeps the beat while the timeline is close enough', () => {
    expect(decide()).toBe('beat')
    expect(decide({ backlog: AGENT_PLAYBACK_MAX_STAGE_BACKLOG - 1 })).toBe('beat')
  })

  it('drops the beat once the timeline falls too far behind the live UI', () => {
    expect(decide({ backlog: AGENT_PLAYBACK_MAX_STAGE_BACKLOG })).toBe('catch-up')
  })

  it('never makes a blocked user wait for the animation', () => {
    expect(decide({ isAwaitingApproval: true })).toBe('catch-up')
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
