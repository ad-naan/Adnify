import { createPersistentPreference } from '@/renderer/settings/persistentPreference'
import { USER_PREFERENCE_KEYS } from '@/renderer/settings/preferenceKeys'

export interface EmotionWelcomePreference {
  dismissed: boolean
}

function isDismissedFlag(value: unknown): boolean {
  return value === true || value === 1 || value === '1'
}

export function normalizeEmotionWelcome(value: unknown): EmotionWelcomePreference {
  // The legacy key stored the bare scalar '1', which JSON.parse turns into 1,
  // so the flag arrives here unwrapped rather than under `dismissed`.
  if (isDismissedFlag(value)) return { dismissed: true }

  const parsed = value && typeof value === 'object' ? value as { dismissed?: unknown } : {}
  return { dismissed: isDismissedFlag(parsed.dismissed) }
}

const preference = createPersistentPreference<EmotionWelcomePreference>({
  ...USER_PREFERENCE_KEYS.emotionWelcome,
  fallback: { dismissed: false },
  normalize: normalizeEmotionWelcome,
})

export function loadEmotionWelcomePreference(): EmotionWelcomePreference {
  return preference.load()
}

export function dismissEmotionWelcome(): void {
  preference.save({ dismissed: true })
}
