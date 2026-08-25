import { describe, expect, it } from 'vitest'
import { cleanConfigValue, cleanEditorConfig } from '../configCleaner'
import { USER_PREFERENCE_STORAGE_KEYS } from '../../../renderer/settings/preferenceKeys'

const validPreferenceSamples: Record<string, unknown> = {
  emotionPanelSettings: { ambientGlow: true, decorativeAnimations: false },
  emotionWelcome: { dismissed: true },
  previewSettings: { autoPrompt: true, dismissedOrigins: [], zoomLevel: 0 },
  keybindings: { 'editor.save': 'Ctrl+S' },
  snippets: [],
  themeId: 'adnify-dark',
  customThemes: [],
  shellRegistry: { presets: [], links: [] },
  userProfile: { avatarStyle: 'adventurer', avatarSeed: 'Adnify', displayName: 'You' },
  'modeStore.currentMode': 'agent',
}

describe('cleanEditorConfig', () => {
  it('preserves valid task runner package manager preferences', () => {
    expect(cleanEditorConfig({ terminal: { nodePackageManager: 'pnpm' } })).toEqual({
      terminal: { nodePackageManager: 'pnpm' },
    })
    expect(cleanEditorConfig({ terminal: { nodePackageManager: 'invalid' } })).toEqual({ terminal: {} })
  })

  it('preserves custom git commit prompts', () => {
    const prompt = 'Write commit messages in Chinese conventional-commit format.'

    expect(cleanEditorConfig({
      git: {
        autoRefresh: false,
        commitPrompt: prompt,
      },
    })).toEqual({
      git: {
        autoRefresh: false,
        commitPrompt: prompt,
      },
    })
  })
})

describe('user preference persistence registry', () => {
  it('keeps every registered preference in the durable config file', () => {
    for (const key of USER_PREFERENCE_STORAGE_KEYS) {
      expect(cleanConfigValue(key, validPreferenceSamples[key])).toEqual(validPreferenceSamples[key])
    }
  })
})
