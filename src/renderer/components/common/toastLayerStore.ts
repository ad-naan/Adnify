import { useEffect, useSyncExternalStore } from 'react'

type Listener = () => void

let elevatedLayerCount = 0
const listeners = new Set<Listener>()

function emitChange(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function acquireElevatedToastLayer(): () => void {
  elevatedLayerCount += 1
  emitChange()

  let released = false
  return () => {
    if (released) return
    released = true
    elevatedLayerCount = Math.max(0, elevatedLayerCount - 1)
    emitChange()
  }
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): boolean {
  return elevatedLayerCount > 0
}

export function useHasElevatedToastLayer(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useElevatedToastLayer(active: boolean = true): void {
  useEffect(() => {
    if (!active) return
    return acquireElevatedToastLayer()
  }, [active])
}
