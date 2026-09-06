// In-memory preference adapter for the browser-only animation fixture.
let decorativeAnimations = true
const listeners = new Set<() => void>()
export const api = { settings: { get: async () => undefined, set: async () => undefined } }
export const loadEmotionPanelSettings = () => ({ decorativeAnimations })
export function subscribeEmotionPanelSettings(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function setDecorativeMotion(enabled: boolean) {
  decorativeAnimations = enabled
  listeners.forEach(listener => listener())
}
