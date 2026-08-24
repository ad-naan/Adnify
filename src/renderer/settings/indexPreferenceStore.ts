import { createPersistentPreference } from '@/renderer/settings/persistentPreference'
import { USER_PREFERENCE_KEYS } from '@/renderer/settings/preferenceKeys'
import {
  DEFAULT_INDEX_PREFERENCE,
  normalizeIndexPreference,
  type IndexPreference,
} from '@/renderer/settings/indexPreference'

export const indexPreference = createPersistentPreference<IndexPreference>({
  ...USER_PREFERENCE_KEYS.indexConfig,
  fallback: DEFAULT_INDEX_PREFERENCE,
  normalize: normalizeIndexPreference,
})
