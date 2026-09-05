import { matchesEvent, type EditorEventInput } from '../types/notifications'

/** Shared contract, one instance per process. Adapters bridge processes explicitly. */
export class EditorEventBus<T extends { type: string } = EditorEventInput> {
  private listeners = new Set<{ pattern: string; callback: (event: T) => void }>()
  subscribe(pattern: string, callback: (event: T) => void): () => void {
    const listener = { pattern, callback }
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  publish(event: T): void {
    for (const listener of this.listeners) {
      if (!matchesEvent(listener.pattern, event.type)) continue
      try {
        listener.callback(event)
      } catch {
        /* Observers cannot break editor work or other observers. */
      }
    }
  }
}
