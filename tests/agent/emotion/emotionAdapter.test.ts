import { describe, expect, it } from 'vitest'
import { emotionAdapter } from '@renderer/agent/emotion/emotionAdapter'

describe('emotionAdapter companion controls', () => {
  it('snoozeCompanion sets snoozedUntil in the future', () => {
    emotionAdapter.snoozeCompanion(60_000)
    const state = emotionAdapter.getCompanionState()
    expect(state.snoozedUntil).toBeGreaterThan(Date.now())
  })

  it('dismissFeedback records dismissed feedback id', () => {
    emotionAdapter.dismissFeedback('feedback-test-1', 'frustration_support:frustrated')
    const state = emotionAdapter.getCompanionState()
    expect(state.dismissedIds).toContain('feedback-test-1')
  })

  it('setSessionMuted toggles session mute flag', () => {
    emotionAdapter.setSessionMuted(true)
    expect(emotionAdapter.getCompanionState().sessionMuted).toBe(true)
    emotionAdapter.setSessionMuted(false)
    expect(emotionAdapter.getCompanionState().sessionMuted).toBe(false)
  })
})
