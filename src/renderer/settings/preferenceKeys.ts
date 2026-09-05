/**
 * Stable persistence keys for user preferences.
 *
 * Feature modules must depend on this key-only registry; the typed registry in
 * userPreferences.ts may depend on feature normalizers without creating cycles.
 */
export const USER_PREFERENCE_KEYS = {
  executionSettings: { storageKey: 'executionSettings', legacyStorageKey: 'adnify-execution-settings' },
  backgroundTaskSettings: { storageKey: 'backgroundTaskSettings', legacyStorageKey: 'adnify-background-task-settings' },
  assetConfiguration: { storageKey: 'assetConfiguration', legacyStorageKey: 'adnify-asset-configuration' },
  emotionPanelSettings: {
    storageKey: 'emotionPanelSettings',
    legacyStorageKey: 'adnify-emotion-panel-settings',
  },
  emotionWelcome: {
    storageKey: 'emotionWelcome',
    legacyStorageKey: 'adnify-emotion-welcome-dismissed',
  },
  previewSettings: {
    storageKey: 'previewSettings',
    legacyStorageKey: 'adnify-preview-settings',
  },
  keybindings: {
    storageKey: 'keybindings',
    legacyStorageKey: 'adnify-keybindings',
  },
  snippets: {
    storageKey: 'snippets',
    legacyStorageKey: 'adnify-snippets',
  },
  themeId: {
    storageKey: 'themeId',
    legacyStorageKey: 'adnify-theme-id',
  },
  customThemes: {
    storageKey: 'customThemes',
    legacyStorageKey: 'adnify-custom-themes',
  },
  shellRegistry: {
    storageKey: 'shellRegistry',
    legacyStorageKey: 'adnify-shell-registry',
  },
  userProfile: {
    storageKey: 'userProfile',
    legacyStorageKey: 'adnify-user-profile',
  },
  currentMode: {
    storageKey: 'modeStore.currentMode',
    legacyStorageKey: 'adnify-mode-store',
  },
  indexConfig: {
    storageKey: 'indexConfig',
    legacyStorageKey: 'adnify-index-config',
  },
} as const

export type UserPreferenceName = keyof typeof USER_PREFERENCE_KEYS
export type UserPreferenceKeyDefinition = (typeof USER_PREFERENCE_KEYS)[UserPreferenceName]
export const USER_PREFERENCE_STORAGE_KEYS: readonly string[] =
  Object.values(USER_PREFERENCE_KEYS).map(definition => definition.storageKey)
