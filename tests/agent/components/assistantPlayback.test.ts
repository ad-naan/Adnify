import { describe, expect, it } from 'vitest'
import type { AssistantPart, PendingChange, ToolCall } from '@renderer/agent/types'
import { TurnTimeline, projectDockFrame, type TurnFrame } from '@renderer/agent/presentation/turnTimeline'
import { projectTrayActions } from '@renderer/agent/presentation/trayProjection'

const text = (content: string): AssistantPart => ({ type: 'text', content })
const thought = (content: string, isStreaming: boolean): AssistantPart => ({ type: 'reasoning', id: 'thought', content, isStreaming })
const tool = (status: ToolCall['status'], id = 'tool'): AssistantPart => ({ type: 'tool_call', toolCall: { id, name: 'read_file', arguments: {}, status } })
function drive(timeline: TurnTimeline, from: number, until: (frame: TurnFrame) => boolean, limit = 10000) {
  for (let now = from + 16; now < from + limit; now += 16) {
    const frame = timeline.tick(now)
    if (until(frame)) return now
  }
  throw new Error('Timeline failed to reach expected state')
}

describe('single presentation timeline', () => {
  it('does not reveal the first body glyph while thought is still streaming', () => {
    const timeline = new TurnTimeline(0)
    timeline.update([thought('thinking', true), text('answer')], true, 0)
    drive(timeline, 0, frame => frame.parts[0]?.type === 'reasoning' && frame.parts[0].content === 'thinking')
    expect(timeline.tick(5000).parts).toHaveLength(1)
  })

  it('drains thought, dwells, closes, then streams the answer without flushing', () => {
    const timeline = new TurnTimeline(0)
    timeline.update([thought('thinking'.repeat(20), true)], true, 0)
    timeline.tick(16)
    timeline.update([thought('thinking'.repeat(20), false), text('answer'.repeat(20))], false, 32)
    const holdingAt = drive(timeline, 32, frame => frame.phase === 'holding')
    expect(timeline.tick(holdingAt + 800).parts).toHaveLength(1)
    expect(timeline.tick(holdingAt + 850).phase).toBe('handoff')
    expect(timeline.tick(holdingAt + 1200).parts).toHaveLength(1)
    const next = timeline.tick(holdingAt + 1310)
    expect(next.parts[1]).toMatchObject({ content: '' })
    const partial = timeline.tick(holdingAt + 1326)
    expect(partial.parts[1]).toMatchObject({ content: expect.any(String) })
    expect((partial.parts[1] as { content: string }).content.length).toBeLessThan(120)
    drive(timeline, holdingAt + 1326, frame => frame.phase === 'complete')
    expect(timeline.getSnapshot().parts[1]).toMatchObject({ content: 'answer'.repeat(20) })
  })

  it('presents accumulated tools one at a time, including fast terminal results', () => {
    const timeline = new TurnTimeline(0)
    timeline.update([tool('success', 'a'), tool('success', 'b'), text('done')], false, 0)
    expect(timeline.getSnapshot().parts).toHaveLength(1)
    expect(timeline.getSnapshot().parts[0]).toMatchObject({ toolCall: { status: 'running' } })
    expect(timeline.tick(480).parts[0]).toMatchObject({ toolCall: { status: 'success' } })
    expect(timeline.tick(1329).openIndex).toBe(0)
    expect(timeline.tick(1330).phase).toBe('handoff')
    expect(timeline.tick(1790).parts).toHaveLength(2)
    expect(timeline.getSnapshot().parts[1]).toMatchObject({ toolCall: { id: 'b', status: 'running' } })
  })

  it('keeps approvals hidden until the same frame mounts their preceding context', () => {
    const approval = (tool('awaiting') as Extract<AssistantPart, { type: 'tool_call' }>).toolCall
    const timeline = new TurnTimeline(0)
    timeline.update([text('context'.repeat(30)), tool('awaiting')], true, 0)
    expect(projectTrayActions(projectDockFrame(timeline.getSnapshot()), [approval], []).tools).toEqual([])
    const at = drive(timeline, 0, frame => frame.parts.length === 2)
    expect(projectTrayActions(projectDockFrame(timeline.getSnapshot()), [approval], []).tools).toEqual([approval])
    expect(timeline.tick(at + 5000).parts).toHaveLength(2)
    expect(timeline.needsTick()).toBe(false)
  })

  it('keeps dock presenting after transport stops until the last text drains', () => {
    const timeline = new TurnTimeline(0)
    timeline.update([text('long answer'.repeat(30))], true, 0)
    timeline.update([text('long answer'.repeat(30))], false, 16)
    expect(projectDockFrame(timeline.getSnapshot()).isPresenting).toBe(true)
    drive(timeline, 16, frame => frame.phase === 'complete')
    expect(projectDockFrame(timeline.getSnapshot()).isPresenting).toBe(false)
    expect(timeline.needsTick()).toBe(false)
  })

  it('accepts final appended tokens even after an earlier completion', () => {
    const timeline = new TurnTimeline(0)
    timeline.update([text('a')], false, 0)
    const at = drive(timeline, 0, frame => frame.phase === 'complete')
    timeline.update([text('a final suffix')], false, at + 16)
    expect(timeline.getSnapshot().phase).not.toBe('complete')
    drive(timeline, at + 16, frame => frame.phase === 'complete')
    expect(timeline.getSnapshot().parts[0]).toMatchObject({ content: 'a final suffix' })
  })

  it('stopping transport releases stale streaming barriers and drains all text', () => {
    const timeline = new TurnTimeline(0)
    timeline.update([thought('thought', true), text('last answer')], false, 0)
    drive(timeline, 0, frame => frame.phase === 'complete')
    expect(timeline.getSnapshot().parts[1]).toMatchObject({ content: 'last answer' })
  })

  it('does not split a surrogate pair', () => {
    const timeline = new TurnTimeline(0)
    timeline.update([text('😀😀😀')], false, 0)
    for (let now = 16; now < 400; now += 16) {
      const frame = timeline.tick(now)
      expect((frame.parts[0] as { content: string }).content.length % 2).toBe(0)
    }
  })

  it('keeps unrelated historical approvals reachable', () => {
    const approval = (tool('awaiting', 'previous') as Extract<AssistantPart, { type: 'tool_call' }>).toolCall
    const timeline = new TurnTimeline(0)
    timeline.update([text('new turn')], true, 0)
    expect(projectTrayActions(projectDockFrame(timeline.getSnapshot()), [approval], []).tools).toEqual([approval])
  })

  it('reveals file actions with the presented terminal result, preserving older actions', () => {
    const timeline = new TurnTimeline(0)
    const current = { toolCallId: 'tool' } as PendingChange
    const previous = { toolCallId: 'older-tool' } as PendingChange
    timeline.update([tool('success')], false, 0)
    expect(projectTrayActions(projectDockFrame(timeline.getSnapshot()), [], [current, previous]).changes).toEqual([previous])
    timeline.tick(480)
    expect(projectTrayActions(projectDockFrame(timeline.getSnapshot()), [], [current, previous]).changes).toEqual([current, previous])
  })
})
