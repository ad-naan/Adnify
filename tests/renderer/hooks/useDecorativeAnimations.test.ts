import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDecorativeAnimations } from '@/renderer/hooks/useDecorativeAnimations'

const state = vi.hoisted(() => ({
  enabled: true,
  value: false,
  scopeEnabled: true,
  cleanups: [] as Array<() => void>,
  preferenceListener: undefined as (() => void) | undefined,
}))

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useContext: () => state.scopeEnabled,
  useSyncExternalStore: (subscribe: (listener: () => void) => () => void, resolve: () => boolean) => {
    state.value = resolve()
    state.cleanups.push(subscribe(() => { state.value = resolve() }))
    return state.value
  },
}))
vi.mock('@/renderer/agent/emotion/panelSettings', () => ({
  loadEmotionPanelSettings: () => ({ decorativeAnimations: state.enabled }),
  subscribeEmotionPanelSettings: (listener: () => void) => {
    state.preferenceListener = listener
    return () => { state.preferenceListener = undefined }
  },
}))

describe('decorative animation lifecycle', () => {
  let windowEvents: EventTarget
  let documentEvents: EventTarget
  let mediaEvents: EventTarget & { matches: boolean }
  let focused: boolean
  let visibilityState: string

  beforeEach(() => {
    state.enabled = true
    state.scopeEnabled = true
    state.cleanups = []
    focused = true
    visibilityState = 'visible'
    windowEvents = new EventTarget()
    documentEvents = new EventTarget()
    mediaEvents = Object.assign(new EventTarget(), { matches: false })
    vi.stubGlobal('window', Object.assign(windowEvents, { matchMedia: () => mediaEvents }))
    Object.defineProperties(documentEvents, {
      visibilityState: { get: () => visibilityState },
      hasFocus: { value: () => focused },
    })
    vi.stubGlobal('document', documentEvents)
  })
  afterEach(() => {
    state.cleanups.forEach(cleanup => cleanup())
    vi.unstubAllGlobals()
  })

  it('pauses unfocused windows even when Electron leaves visibility visible', () => {
    useDecorativeAnimations()
    expect(state.value).toBe(true)
    focused = false
    windowEvents.dispatchEvent(new Event('blur'))
    expect(state.value).toBe(false)
    focused = true
    windowEvents.dispatchEvent(new Event('focus'))
    expect(state.value).toBe(true)
  })

  it('honors visibility, user preference and reduced motion on resume', () => {
    useDecorativeAnimations()
    visibilityState = 'hidden'
    documentEvents.dispatchEvent(new Event('visibilitychange'))
    expect(state.value).toBe(false)
    visibilityState = 'visible'
    documentEvents.dispatchEvent(new Event('visibilitychange'))
    expect(state.value).toBe(true)
    mediaEvents.matches = true
    mediaEvents.dispatchEvent(new Event('change'))
    windowEvents.dispatchEvent(new Event('focus'))
    expect(state.value).toBe(false)
    mediaEvents.matches = false
    mediaEvents.dispatchEvent(new Event('change'))
    expect(state.value).toBe(true)
    state.enabled = false
    state.preferenceListener?.()
    windowEvents.dispatchEvent(new Event('focus'))
    expect(state.value).toBe(false)
  })

  it('removes listeners on unmount', () => {
    useDecorativeAnimations()
    state.cleanups.pop()?.()
    expect(state.preferenceListener).toBeUndefined()
    focused = false
    visibilityState = 'hidden'
    mediaEvents.matches = true
    windowEvents.dispatchEvent(new Event('blur'))
    documentEvents.dispatchEvent(new Event('visibilitychange'))
    mediaEvents.dispatchEvent(new Event('change'))
    expect(state.value).toBe(true)
  })

  it('keeps shared listeners until the last consumer leaves', () => {
    const listen = vi.spyOn(windowEvents, 'addEventListener')
    useDecorativeAnimations()
    useDecorativeAnimations()
    expect(listen.mock.calls.filter(([name]) => name === 'blur')).toHaveLength(1)
    state.cleanups.pop()?.()
    expect(state.preferenceListener).toBeDefined()
    focused = false
    windowEvents.dispatchEvent(new Event('blur'))
    expect(state.value).toBe(false)
    state.cleanups.pop()?.()
    expect(state.preferenceListener).toBeUndefined()
  })

  it('keeps an occluded scope still even when the window is focused', () => {
    state.scopeEnabled = false
    expect(useDecorativeAnimations()).toBe(false)
    state.scopeEnabled = true
    expect(useDecorativeAnimations()).toBe(true)
  })
})
