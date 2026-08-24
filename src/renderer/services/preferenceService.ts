import { api } from '@/renderer/services/electronAPI'
import {
  USER_PREFERENCES,
  type UserPreferenceDefinition,
} from '@/renderer/settings/userPreferences'
import { USER_PREFERENCE_STORAGE_KEYS } from '@/renderer/settings/preferenceKeys'

export async function resetUserPreferences(): Promise<void> {
  await Promise.all([
    ...USER_PREFERENCE_STORAGE_KEYS.map(key => api.settings.set(key, undefined)),
    api.settings.set('modeStore.adnify-mode-store', undefined),
    api.settings.set('currentTheme', undefined),
    api.settings.set('themeBg', undefined),
  ])
}

export async function exportUserPreferences(
  includeSensitive = false,
): Promise<Record<string, unknown>> {
  const entries = await Promise.all(
    Object.entries(USER_PREFERENCES).map(async ([name, definition]) => {
      const preference = definition as UserPreferenceDefinition<unknown>
      const value = await api.settings.get(preference.storageKey)
      const hasValue = value !== undefined && value !== null
      const normalized = hasValue ? preference.normalize(value) : preference.fallback
      const exported = !includeSensitive && preference.redactForExport
        ? preference.redactForExport(normalized)
        : normalized
      return [name, exported] as const
    }),
  )

  return Object.fromEntries(entries)
}

export async function importUserPreferences(preferences: unknown): Promise<void> {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return

  await Promise.all(
    Object.entries(USER_PREFERENCES).map(async ([name, definition]) => {
      const preference = definition as UserPreferenceDefinition<unknown>
      const value = (preferences as Record<string, unknown>)[name]
      if (value !== undefined) {
        const normalized = preference.normalize(value)
        const currentValue = await api.settings.get(preference.storageKey)
        const current = currentValue === undefined || currentValue === null
          ? preference.fallback
          : preference.normalize(currentValue)
        const restored = preference.restoreLocalSecrets
          ? preference.restoreLocalSecrets(normalized, current)
          : normalized
        await api.settings.set(preference.storageKey, restored)
      }
    }),
  )
}
