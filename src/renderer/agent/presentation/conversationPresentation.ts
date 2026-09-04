import { createStore } from 'zustand/vanilla'
import type { AssistantPart } from '../types'
import { projectDockFrame, TurnTimeline, type DockFrame, type TurnFrame } from './turnTimeline'

interface PresentationState {
  turns: Record<string, TurnFrame>
  dock: DockFrame | undefined
  currentMessageId: string | undefined
}

export interface PresentationScheduler {
  now(): number
  schedule(callback: () => void, delayMs: number): () => void
}

function sameDock(a: DockFrame | undefined, b: DockFrame) {
  return a?.isPresenting === b.isPresenting
    && a.sourceToolIds.length === b.sourceToolIds.length
    && a.sourceToolIds.every((id, index) => id === b.sourceToolIds[index])
    && Object.keys(a.toolStates).length === Object.keys(b.toolStates).length
    && Object.keys(b.toolStates).every(id => a.toolStates[id] === b.toolStates[id])
}

/** Conversation lifetime, independent of virtualized row mounts. One scheduled tick. */
export class ConversationPresentation {
  readonly store = createStore<PresentationState>(() => ({ turns: {}, dock: undefined, currentMessageId: undefined }))
  private timelines = new Map<string, TurnTimeline>()
  private cancelTick: (() => void) | undefined
  private threadId: string | null = null

  constructor(private scheduler: PresentationScheduler) {}

  observe(threadId: string | null, messageId: string | undefined, parts: AssistantPart[], active: boolean) {
    if (this.threadId !== threadId) {
      this.dispose()
      this.threadId = threadId
    }
    if (!messageId) { this.dispose(); return }
    let timeline = this.timelines.get(messageId)
    if (!timeline && !active) return // Historical turns are rendered statically.
    if (!timeline) {
      // Retain only turns still draining and the current turn; no history cache.
      for (const [id, previous] of this.timelines) {
        if (previous.getSnapshot().phase === 'complete') this.timelines.delete(id)
      }
      timeline = new TurnTimeline(this.scheduler.now())
      this.timelines.set(messageId, timeline)
    }
    timeline.update(parts, active, this.scheduler.now())
    this.publish(messageId)
    // A source update may introduce text during a scheduled reading dwell.
    // Replace the pending wake-up, never leave the new text waiting on that deadline.
    this.cancelTick?.()
    this.cancelTick = undefined
    this.schedule()
  }

  private publish(currentMessageId = this.store.getState().currentMessageId) {
    const turns = Object.fromEntries([...this.timelines].map(([id, timeline]) => [id, timeline.getSnapshot()]))
    const current = currentMessageId ? turns[currentMessageId] : undefined
    const nextDock = current ? projectDockFrame(current) : undefined
    const previous = this.store.getState().dock
    const dock = nextDock && sameDock(previous, nextDock) ? previous : nextDock
    this.store.setState({ turns, dock, currentMessageId })
  }

  private schedule() {
    if (this.cancelTick) return
    const delays = [...this.timelines.values()].flatMap(timeline => {
      const delay = timeline.nextWakeIn()
      return delay === null ? [] : [delay]
    })
    if (!delays.length) return
    this.cancelTick = this.scheduler.schedule(() => {
      this.cancelTick = undefined
      const now = this.scheduler.now()
      for (const timeline of this.timelines.values()) {
        if (timeline.needsTick()) timeline.tick(now)
      }
      this.publish()
      this.schedule()
    }, Math.min(...delays))
  }

  dispose() {
    this.cancelTick?.()
    this.cancelTick = undefined
    this.timelines.clear()
    this.store.setState({ turns: {}, dock: undefined, currentMessageId: undefined })
  }
}
