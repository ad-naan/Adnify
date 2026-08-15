import { describe, it, expect } from 'vitest'
import { create } from 'zustand'

/**
 * Guards the mechanism behind `initializeAgentSessionSync`.
 *
 * That function previously monkey-patched `useAgentStore.setState` to detect
 * changes to the durable slices. It never fired. Zustand v5's `createStoreImpl`
 * hands its *internal* `setState` closure to the slice initializer, and
 * `Object.assign(useBoundStore, api)` only exposes a copy of the reference — so
 * every `set(...)` inside a slice bypassed the patched function.
 *
 * The user-visible effect: the debounced session write never ran. Thread
 * rename/delete/switch, todo edits and branch mutations stayed in memory until
 * the next agent run or app shutdown happened to flush.
 *
 * These tests pin the two facts that make `subscribe` the correct hook, so a
 * future refactor cannot silently regress to patching `setState`.
 */

interface ProbeStore {
  n: number
  bump: () => void
}

const makeStore = () =>
  create<ProbeStore>()((set) => ({
    n: 0,
    bump: () => set((state) => ({ n: state.n + 1 })),
  }))

describe('zustand v5 change detection', () => {
  it('patching setState does NOT observe slice-level set()', () => {
    const useProbe = makeStore()
    let intercepted = 0

    const raw = useProbe.setState
    useProbe.setState = ((partial: never, replace?: never) => {
      intercepted++
      return raw(partial, replace)
    }) as typeof useProbe.setState

    useProbe.getState().bump()

    expect(useProbe.getState().n).toBe(1)
    // The state changed, but the patch saw nothing: this is the original bug.
    expect(intercepted).toBe(0)

    // Only a direct call on the store API goes through the patch.
    useProbe.setState({ n: 99 })
    expect(intercepted).toBe(1)
  })

  it('subscribe observes every slice-level set()', () => {
    const useProbe = makeStore()
    const seen: Array<{ next: number; prev: number }> = []

    useProbe.subscribe((next, prev) => seen.push({ next: next.n, prev: prev.n }))

    useProbe.getState().bump()
    useProbe.getState().bump()

    expect(seen).toEqual([
      { next: 1, prev: 0 },
      { next: 2, prev: 1 },
    ])
  })

  it('subscribe receives both next and previous state for reference comparison', () => {
    // initializeAgentSessionSync compares prev/next slice references
    // (threads, branches, ...) to decide whether to schedule a write.
    const useProbe = makeStore()
    let sawReferenceChange = false

    useProbe.subscribe((next, prev) => {
      if (prev.n !== next.n) sawReferenceChange = true
    })

    useProbe.getState().bump()
    expect(sawReferenceChange).toBe(true)
  })
})
