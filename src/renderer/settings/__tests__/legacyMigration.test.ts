import { describe, expect, it } from 'vitest'
import { normalizeEmotionWelcome } from '@/renderer/agent/emotion/welcomePreference'

describe('normalizeEmotionWelcome', () => {
  // The pre-refactor writer was localStorage.setItem(key, '1'), so the migration
  // reader hands this normalizer a bare scalar rather than a { dismissed } object.
  it('migrates the legacy scalar written by the old panel', () => {
    expect(normalizeEmotionWelcome(1)).toEqual({ dismissed: true })
    expect(normalizeEmotionWelcome('1')).toEqual({ dismissed: true })
  })

  it('reads the durable object form', () => {
    expect(normalizeEmotionWelcome({ dismissed: true })).toEqual({ dismissed: true })
    expect(normalizeEmotionWelcome({ dismissed: false })).toEqual({ dismissed: false })
  })

  it('falls back to not-dismissed for absent or unrelated values', () => {
    expect(normalizeEmotionWelcome(undefined)).toEqual({ dismissed: false })
    expect(normalizeEmotionWelcome(null)).toEqual({ dismissed: false })
    expect(normalizeEmotionWelcome(0)).toEqual({ dismissed: false })
    expect(normalizeEmotionWelcome('nope')).toEqual({ dismissed: false })
    expect(normalizeEmotionWelcome({})).toEqual({ dismissed: false })
  })
})
