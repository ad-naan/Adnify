import { createPersistentPreference } from '@/renderer/settings/persistentPreference'
import { USER_PREFERENCE_KEYS } from '@/renderer/settings/preferenceKeys'
import type { PreviewDevice, PreviewOrientation } from '@shared/preview/device'

export interface PreviewSettings {
  /** Whether opening a workspace with a local dev server should prompt automatically. */
  autoPrompt: boolean
  /** Origins explicitly dismissed by the user, capped to prevent unbounded growth. */
  dismissedOrigins: string[]
  /** Guest-page zoom level relative to its original size. */
  zoomLevel: number
  device: PreviewDevice
  orientation: PreviewOrientation
}

export const DEFAULT_PREVIEW_SETTINGS: PreviewSettings = {
  autoPrompt: false,
  dismissedOrigins: [],
  zoomLevel: 0,
  device: 'desktop',
  orientation: 'portrait',
}

const MAX_DISMISSED_ORIGINS = 50

export function normalizePreviewSettings(value: unknown): PreviewSettings {
  const parsed = (value && typeof value === 'object' ? value : {}) as Partial<PreviewSettings>
  const dismissedOrigins = Array.isArray(parsed.dismissedOrigins)
    ? parsed.dismissedOrigins
      .filter((item): item is string => typeof item === 'string')
      .slice(-MAX_DISMISSED_ORIGINS)
    : []

  return {
    autoPrompt: typeof parsed.autoPrompt === 'boolean'
      ? parsed.autoPrompt
      : DEFAULT_PREVIEW_SETTINGS.autoPrompt,
    dismissedOrigins,
    device: parsed.device === 'phone' || parsed.device === 'tablet' ? parsed.device : 'desktop',
    orientation: parsed.orientation === 'landscape' ? 'landscape' : 'portrait',
    zoomLevel: typeof parsed.zoomLevel === 'number' && Number.isFinite(parsed.zoomLevel)
      ? Math.min(Math.max(parsed.zoomLevel, -5), 5)
      : DEFAULT_PREVIEW_SETTINGS.zoomLevel,
  }
}

const preference = createPersistentPreference<PreviewSettings>({
  ...USER_PREFERENCE_KEYS.previewSettings, fallback: DEFAULT_PREVIEW_SETTINGS, normalize: normalizePreviewSettings,
})

export function loadPreviewSettings(): PreviewSettings {
  return preference.load()
}

export function savePreviewSettings(settings: PreviewSettings): void {
  preference.save(settings)
}

export function updatePreviewSettings(patch: Partial<PreviewSettings>): PreviewSettings {
  return preference.update(patch)
}

export function subscribePreviewSettings(listener: (settings: PreviewSettings) => void): () => void {
  return preference.subscribe(listener)
}

export function isOriginDismissed(origin: string): boolean {
  return loadPreviewSettings().dismissedOrigins.includes(origin)
}

export function dismissOrigin(origin: string): void {
  const current = loadPreviewSettings()
  if (current.dismissedOrigins.includes(origin)) return
  updatePreviewSettings({
    dismissedOrigins: [...current.dismissedOrigins, origin].slice(-MAX_DISMISSED_ORIGINS),
  })
}

export function clearDismissedOrigins(): void {
  updatePreviewSettings({ dismissedOrigins: [] })
}
