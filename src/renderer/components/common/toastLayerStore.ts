import { useLayoutEffect, useSyncExternalStore } from 'react'

type Listener = () => void

let elevatedLayerCount = 0
const listeners = new Set<Listener>()
let toastAnchor: HTMLElement | null = null
const anchorListeners = new Set<Listener>()
export function setToastAnchor(element: HTMLElement | null): void {
  toastAnchor = element
  for (const listener of anchorListeners) listener()
}
const subscribeAnchor = (listener: Listener) => { anchorListeners.add(listener); return () => { anchorListeners.delete(listener) } }
export function useToastAnchor(): HTMLElement | null {
  return useSyncExternalStore(subscribeAnchor, () => toastAnchor, () => null)
}

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
  useLayoutEffect(() => {
    if (!active) return
    return acquireElevatedToastLayer()
  }, [active])
}
