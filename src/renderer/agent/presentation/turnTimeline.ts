import type { AssistantPart, ToolCall } from '../types'
import { AGENT_DISCLOSURE_CLOSE_DELAY_MS, AGENT_DISCLOSURE_COLLAPSE_MS, AGENT_ROW_ENTER_MS } from './disclosureMotion'

export type TimelinePhase = 'presenting' | 'holding' | 'handoff' | 'complete'
export interface TurnFrame {
  sourceParts: AssistantPart[]
  sourceToolIds: string[]
  parts: AssistantPart[]
  activeIndex: number
  openIndex: number
  phase: TimelinePhase
}

export function isTextual(part: AssistantPart): part is Extract<AssistantPart, { type: 'text' | 'reasoning' | 'search' }> {
  return part.type === 'text' || part.type === 'reasoning' || part.type === 'search'
}

export function isBlocking(part: AssistantPart): boolean {
  if (part.type === 'reasoning' || part.type === 'search') return !!part.isStreaming
  if (part.type === 'tool_call') return ['pending', 'running', 'awaiting'].includes(part.toolCall.status)
  return part.type === 'lint_check' && part.status === 'checking'
}

function hasDisclosure(part: AssistantPart): boolean {
  return ['reasoning', 'search', 'tool_call', 'lint_check'].includes(part.type)
}

function safeTextEnd(text: string, end: number): number {
  const previous = text.charCodeAt(end - 1)
  return end < text.length && previous >= 0xd800 && previous <= 0xdbff ? end + 1 : end
}

/** Pure, clock-injected state machine. No React, DOM, execution writes or timers. */
export class TurnTimeline {
  private source: AssistantPart[] = []
  private settledParts: AssistantPart[] = []
  private active = true
  private cursor = 0
  private characters = 0
  private budget = 0
  private enteredAt: number
  private deadline: number | null = null
  private phase: TimelinePhase = 'presenting'
  private previousTime: number
  private sourceToolIds: string[] = []
  private frame: TurnFrame = { parts: [], sourceParts: [], sourceToolIds: [], activeIndex: -1, openIndex: -1, phase: 'presenting' }

  constructor(now: number) {
    this.enteredAt = this.previousTime = now
  }

  update(parts: AssistantPart[], active: boolean, now: number): TurnFrame {
    // A final persisted snapshot may append the last tokens after transport ends.
    // Keep the existing cursor and drain them; never replace the tape with full text.
    this.source = parts
    this.settledParts = parts.map(part => (part.type === 'reasoning' || part.type === 'search') && part.isStreaming
      ? { ...part, isStreaming: false } : part)
    this.sourceToolIds = parts.flatMap(part => part.type === 'tool_call' ? [part.toolCall.id] : [])
    this.active = active
    if (this.cursor >= parts.length && parts.length > 0) this.cursor = parts.length - 1
    const current = parts[this.cursor]
    if (this.phase === 'complete' && (active || (current && isTextual(current) && this.characters < current.content.length)
      || this.cursor < parts.length - 1)) {
      this.phase = 'presenting'
      this.deadline = null
    }
    return this.tick(now)
  }

  tick(now: number): TurnFrame {
    const elapsed = Math.max(0, Math.min(now - this.previousTime, 80))
    this.previousTime = now
    const part = this.source[this.cursor]
    if (!part) {
      this.phase = this.active ? 'presenting' : 'complete'
      return this.publish()
    }
    const pendingText = isTextual(part) && this.characters < part.content.length
    if ((pendingText || (this.active && isBlocking(part))) && this.phase !== 'presenting') {
      this.phase = 'presenting'
      this.deadline = null
    }
    if (this.phase === 'presenting') {
      if (pendingText && isTextual(part)) {
        const backlog = part.content.length - this.characters
        this.budget += elapsed / 1000 * 48 * (1 + Math.min(backlog / 56, 3))
        const count = Math.min(Math.floor(this.budget), backlog)
        this.budget -= count
        this.characters = safeTextEnd(part.content, this.characters + count)
        // Publish the last glyph before starting the reading dwell.
        return this.publish()
      }
      if (this.active && (isBlocking(part) || this.cursor === this.source.length - 1)) return this.publish()
      if (hasDisclosure(part)) {
        this.phase = 'holding'
        this.deadline = Math.max(now, this.enteredAt + AGENT_ROW_ENTER_MS) + AGENT_DISCLOSURE_CLOSE_DELAY_MS
      } else {
        this.advance(now)
      }
    } else if (this.phase === 'holding' && now >= this.deadline!) {
      this.phase = 'handoff'
      this.deadline = now + AGENT_DISCLOSURE_COLLAPSE_MS
    } else if (this.phase === 'handoff' && now >= this.deadline!) {
      this.advance(now)
    }
    return this.publish()
  }

  private advance(now: number) {
    if (this.cursor >= this.source.length - 1) {
      this.phase = this.active ? 'presenting' : 'complete'
      return
    }
    this.cursor += 1
    this.characters = 0
    this.budget = 0
    this.enteredAt = now
    this.deadline = null
    this.phase = 'presenting'
  }

  private publish(): TurnFrame {
    const visible = this.settledParts.slice(0, this.cursor)
    const part = this.source[this.cursor]
    let activeIndex = -1
    if (part) {
      let presented = part
      if (isTextual(part)) {
        const content = part.content.slice(0, this.characters)
        const streaming = this.characters < part.content.length || (this.active && (isBlocking(part) || this.cursor === this.source.length - 1))
        presented = part.type === 'text' ? { ...part, content } : { ...part, content, isStreaming: streaming }
        if (streaming) activeIndex = this.cursor
      } else if (part.type === 'tool_call' && !isBlocking(part) && this.previousTime < this.enteredAt + AGENT_ROW_ENTER_MS) {
        // A fast result still gets an entrance before its terminal icon/results.
        presented = { ...part, toolCall: { ...part.toolCall, status: 'running', result: undefined } }
      }
      visible.push(presented)
    }
    const openIndex = part && this.phase !== 'handoff' && this.phase !== 'complete' ? this.cursor : -1
    this.frame = { parts: visible, sourceParts: this.source, sourceToolIds: this.sourceToolIds, activeIndex, openIndex, phase: this.phase }
    return this.frame
  }

  getSnapshot(): TurnFrame { return this.frame }

  /** Sleep on source barriers; a new source event wakes the shared scheduler. */
  needsTick(): boolean {
    return this.nextWakeIn() !== null
  }

  nextWakeIn(): number | null {
    if (this.phase === 'complete') return null
    if (this.phase === 'holding' || this.phase === 'handoff') return Math.max(0, this.deadline! - this.previousTime)
    const part = this.source[this.cursor]
    if (!part) return null
    if (isTextual(part) && this.characters < part.content.length) return 16
    if (part.type === 'tool_call' && this.previousTime < this.enteredAt + AGENT_ROW_ENTER_MS) return this.enteredAt + AGENT_ROW_ENTER_MS - this.previousTime
    return this.active && (isBlocking(part) || this.cursor === this.source.length - 1) ? null : 16
  }
}

export interface DockFrame {
  sourceToolIds: string[]
  isPresenting: boolean
  toolStates: Record<string, ToolCall['status']>
}

/** Both message and dock are projections of the same committed timeline frame. */
export function projectDockFrame(frame: TurnFrame): DockFrame {
  return {
    sourceToolIds: frame.sourceToolIds,
    isPresenting: frame.phase !== 'complete',
    toolStates: Object.fromEntries(frame.parts.flatMap(part => part.type === 'tool_call'
      ? [[part.toolCall.id, part.toolCall.status]] : [])),
  }
}
