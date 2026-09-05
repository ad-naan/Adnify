import { createPersistentPreference } from '../settings/persistentPreference'
import { USER_PREFERENCE_KEYS } from '../settings/preferenceKeys'
import { DEFAULT_BACKGROUND_TASK_SETTINGS, normalizeBackgroundTaskSettings } from '@shared/types/backgroundTasks'

export const backgroundTaskSettings = createPersistentPreference({
  ...USER_PREFERENCE_KEYS.backgroundTaskSettings,
  migration: false,
  fallback: DEFAULT_BACKGROUND_TASK_SETTINGS,
  normalize: normalizeBackgroundTaskSettings,
})
