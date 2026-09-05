import { DEFAULT_EMOTION_PANEL_SETTINGS, normalizeEmotionPanelSettings, type EmotionPanelSettings } from '@/renderer/agent/emotion/panelSettings'
import { DEFAULT_PREVIEW_SETTINGS, normalizePreviewSettings, type PreviewSettings } from '@/renderer/preview/previewSettings'
import { DEFAULT_BACKGROUND_TASK_SETTINGS, normalizeBackgroundTaskSettings, type BackgroundTaskSettings } from '@shared/types/backgroundTasks'
import { normalizeUserProfile, DEFAULT_USER_PROFILE, type UserProfile } from '@/renderer/settings/userProfile'
import { normalizeCodeSnippets, type CodeSnippet } from '@/renderer/services/snippetService'
import { normalizeKeybindingOverrides } from '@/renderer/services/keybindingService'
import { normalizeCustomThemes, normalizeThemeId, builtinThemes, type Theme } from '@/renderer/config/themeConfig'
import { DEFAULT_SHELL_STATE, normalizeShellState, type ShellState } from '@/renderer/shell/types/index'
import { USER_PREFERENCE_KEYS, type UserPreferenceName } from '@/renderer/settings/preferenceKeys'
import { normalizeMode, type WorkMode } from '@/renderer/modes/types'
import { normalizeEmotionWelcome, type EmotionWelcomePreference } from '@/renderer/agent/emotion/welcomePreference'
import { normalizeIndexPreference, type IndexPreference } from '@/renderer/settings/indexPreference'
import { DEFAULT_ASSET_CONFIGURATION, normalizeAssetConfiguration, type AssetConfiguration } from '@shared/assets/configuration'

export interface UserPreferenceDefinition<T> {
  storageKey: string
  legacyStorageKey: string
  fallback: T
  normalize: (value: unknown) => T
  redactForExport?: (value: T) => T
  restoreLocalSecrets?: (imported: T, current: T) => T
}

const REDACTED = '__ADNIFY_REDACTED__'

function redactIndexPreference(value: IndexPreference): IndexPreference {
  if (!value.embedding?.apiKey) return value
  return {
    ...value,
    embedding: {
      ...value.embedding,
      apiKey: REDACTED,
    },
  }
}

function restoreIndexPreference(imported: IndexPreference, current: IndexPreference): IndexPreference {
  if (imported.embedding?.apiKey !== REDACTED) return imported
  const currentKey = current.embedding?.apiKey
  if (!currentKey) {
    return { ...imported, embedding: { ...imported.embedding, apiKey: undefined } }
  }

  const sameProvider = (imported.embedding.provider ?? undefined) === (current.embedding?.provider ?? undefined)
  const sameEndpoint = (imported.embedding.baseUrl ?? undefined) === (current.embedding?.baseUrl ?? undefined)
  return {
    ...imported,
    embedding: {
      ...imported.embedding,
      apiKey: sameProvider && sameEndpoint ? currentKey : undefined,
    },
  }
}

function redactShellState(value: ShellState): ShellState {
  return {
    ...value,
    links: value.links.map(link => {
      if (!link.remote) return link
      return {
        ...link,
        remote: {
          ...link.remote,
          password: link.remote.password ? REDACTED : link.remote.password,
          privateKeyPath: link.remote.privateKeyPath ? REDACTED : link.remote.privateKeyPath,
        },
      }
    }),
  }
}

function restoreShellState(imported: ShellState, current: ShellState): ShellState {
  const currentLinks = new Map(current.links.map(link => [link.id, link]))

  return {
    ...imported,
    links: imported.links.map(link => {
      if (!link.remote) return link
      const currentRemote = currentLinks.get(link.id)?.remote
      return {
        ...link,
        remote: {
          ...link.remote,
          password: link.remote.password === REDACTED
            ? currentRemote?.password
            : link.remote.password,
          privateKeyPath: link.remote.privateKeyPath === REDACTED
            ? currentRemote?.privateKeyPath
            : link.remote.privateKeyPath,
        },
      }
    }),
  }
}

export const USER_PREFERENCES = {
  backgroundTaskSettings: {
    ...USER_PREFERENCE_KEYS.backgroundTaskSettings,
    fallback: DEFAULT_BACKGROUND_TASK_SETTINGS,
    normalize: normalizeBackgroundTaskSettings,
  } satisfies UserPreferenceDefinition<BackgroundTaskSettings>,
  assetConfiguration: {
    ...USER_PREFERENCE_KEYS.assetConfiguration,
    fallback: DEFAULT_ASSET_CONFIGURATION,
    normalize: normalizeAssetConfiguration,
  } satisfies UserPreferenceDefinition<AssetConfiguration>,
  emotionPanelSettings: {
    ...USER_PREFERENCE_KEYS.emotionPanelSettings,
    fallback: DEFAULT_EMOTION_PANEL_SETTINGS,
    normalize: normalizeEmotionPanelSettings,
  } satisfies UserPreferenceDefinition<EmotionPanelSettings>,
  emotionWelcome: {
    ...USER_PREFERENCE_KEYS.emotionWelcome,
    fallback: { dismissed: false },
    normalize: normalizeEmotionWelcome,
  } satisfies UserPreferenceDefinition<EmotionWelcomePreference>,
  previewSettings: {
    ...USER_PREFERENCE_KEYS.previewSettings,
    fallback: DEFAULT_PREVIEW_SETTINGS,
    normalize: normalizePreviewSettings,
  } satisfies UserPreferenceDefinition<PreviewSettings>,
  keybindings: {
    ...USER_PREFERENCE_KEYS.keybindings,
    fallback: {},
    normalize: normalizeKeybindingOverrides,
  } satisfies UserPreferenceDefinition<Record<string, string>>,
  snippets: {
    ...USER_PREFERENCE_KEYS.snippets,
    fallback: [],
    normalize: normalizeCodeSnippets,
  } satisfies UserPreferenceDefinition<CodeSnippet[]>,
  themeId: {
    ...USER_PREFERENCE_KEYS.themeId,
    fallback: builtinThemes[0].id,
    normalize: normalizeThemeId,
  } satisfies UserPreferenceDefinition<string>,
  customThemes: {
    ...USER_PREFERENCE_KEYS.customThemes,
    fallback: [],
    normalize: normalizeCustomThemes,
  } satisfies UserPreferenceDefinition<Theme[]>,
  shellRegistry: {
    ...USER_PREFERENCE_KEYS.shellRegistry,
    fallback: DEFAULT_SHELL_STATE,
    normalize: normalizeShellState,
    redactForExport: redactShellState,
    restoreLocalSecrets: restoreShellState,
  } satisfies UserPreferenceDefinition<ShellState>,
  userProfile: {
    ...USER_PREFERENCE_KEYS.userProfile,
    fallback: DEFAULT_USER_PROFILE,
    normalize: normalizeUserProfile,
  } satisfies UserPreferenceDefinition<UserProfile>,
  currentMode: {
    ...USER_PREFERENCE_KEYS.currentMode,
    fallback: 'agent',
    normalize: normalizeMode,
  } satisfies UserPreferenceDefinition<WorkMode>,
  indexConfig: {
    ...USER_PREFERENCE_KEYS.indexConfig,
    fallback: { mode: 'structural' },
    normalize: normalizeIndexPreference,
    redactForExport: redactIndexPreference,
    restoreLocalSecrets: restoreIndexPreference,
  } satisfies UserPreferenceDefinition<IndexPreference>,
} as const

export type UserPreferenceKey = UserPreferenceName
