import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PREVIEW_SETTINGS,
  clearDismissedOrigins,
  dismissOrigin,
  isOriginDismissed,
  loadPreviewSettings,
  savePreviewSettings,
  subscribePreviewSettings,
  updatePreviewSettings,
} from '@/renderer/preview/previewSettings'

describe('previewSettings', () => {
  beforeEach(() => {
    localStorage.clear()
    savePreviewSettings(DEFAULT_PREVIEW_SETTINGS)
  })

  it('defaults auto-prompt to off — the popup is opt-in', () => {
    localStorage.clear()
    expect(loadPreviewSettings().autoPrompt).toBe(false)
  })

  it('falls back to defaults on corrupt storage instead of throwing', () => {
    localStorage.setItem('adnify-preview-settings', '{not json')
    expect(loadPreviewSettings()).toEqual(DEFAULT_PREVIEW_SETTINGS)
  })

  it('drops fields of the wrong type', () => {
    localStorage.setItem('adnify-preview-settings', JSON.stringify({
      autoPrompt: 'yes',
      dismissedOrigins: ['http://127.0.0.1:5173', 42, null],
      zoomLevel: 'big',
    }))

    const settings = loadPreviewSettings()
    expect(settings.autoPrompt).toBe(false)
    expect(settings.dismissedOrigins).toEqual(['http://127.0.0.1:5173'])
    expect(settings.zoomLevel).toBe(0)
  })

  it('clamps the zoom level to a usable range', () => {
    expect(updatePreviewSettings({ zoomLevel: 99 }).zoomLevel).toBe(5)
    expect(updatePreviewSettings({ zoomLevel: -99 }).zoomLevel).toBe(-5)
  })

  it('caps the dismissed list so it cannot grow without bound', () => {
    for (let port = 3000; port < 3080; port++) {
      dismissOrigin(`http://127.0.0.1:${port}`)
    }

    const { dismissedOrigins } = loadPreviewSettings()
    expect(dismissedOrigins.length).toBe(50)
    // 保留的是最近的，最早的被丢掉
    expect(dismissedOrigins.at(-1)).toBe('http://127.0.0.1:3079')
    expect(dismissedOrigins).not.toContain('http://127.0.0.1:3000')
  })

  it('does not duplicate an already dismissed origin', () => {
    dismissOrigin('http://127.0.0.1:5173')
    dismissOrigin('http://127.0.0.1:5173')

    expect(loadPreviewSettings().dismissedOrigins).toEqual(['http://127.0.0.1:5173'])
    expect(isOriginDismissed('http://127.0.0.1:5173')).toBe(true)
    expect(isOriginDismissed('http://127.0.0.1:3000')).toBe(false)
  })

  it('clears dismissals so muted servers surface again', () => {
    dismissOrigin('http://127.0.0.1:5173')
    clearDismissedOrigins()
    expect(isOriginDismissed('http://127.0.0.1:5173')).toBe(false)
  })

  it('notifies subscribers and stops after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribePreviewSettings(listener)

    updatePreviewSettings({ autoPrompt: true })
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ autoPrompt: true }))

    unsubscribe()
    updatePreviewSettings({ autoPrompt: false })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
