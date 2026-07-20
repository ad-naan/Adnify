import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_EMOTION_PANEL_SETTINGS,
  isEmotionPrivacyMode,
  loadEmotionPanelSettings,
  saveEmotionPanelSettings,
} from '@renderer/agent/emotion/panelSettings'

describe('emotion panelSettings', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults privacyMode to false', () => {
    expect(loadEmotionPanelSettings().privacyMode).toBe(false)
    expect(isEmotionPrivacyMode()).toBe(false)
  })

  it('persists privacyMode when saved', () => {
    saveEmotionPanelSettings({
      ...DEFAULT_EMOTION_PANEL_SETTINGS,
      privacyMode: true,
    })
    expect(loadEmotionPanelSettings().privacyMode).toBe(true)
    expect(isEmotionPrivacyMode()).toBe(true)
  })
})
