import { createPersistentPreference } from './persistentPreference'
import { USER_PREFERENCE_KEYS } from './preferenceKeys'
import { DEFAULT_ASSET_CONFIGURATION, normalizeAssetConfiguration } from '@shared/assets/configuration'

// Business commands (save with credentials, directory pickers) commit through the main process.
// Observe the same registered preference used for settings backup, import and reset.
export const assetConfigurationPreference = createPersistentPreference({
  ...USER_PREFERENCE_KEYS.assetConfiguration,
  migration: false,
  fallback: DEFAULT_ASSET_CONFIGURATION,
  normalize: normalizeAssetConfiguration,
})
