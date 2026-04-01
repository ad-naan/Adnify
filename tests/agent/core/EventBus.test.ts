import { describe, expect, it } from 'vitest'
import { EventBus } from '@renderer/agent/core/EventBus'
import type { EmotionFeedbackPayload } from '@renderer/agent/types/emotion'

describe('EventBus emotion feedback', () => {
  it('delivers structured emotion feedback events to subscribers', () => {
    const payload: EmotionFeedbackPayload = {
      id: 'feedback-1',
      type: 'frustration_support',
      priority: 6,
      emotionState: 'frustrated',
      message: 'Take a breath and inspect the failing command output.',
      shortMessage: 'Inspect failing output',
      actions: [{ id: 'ask_ai', label: 'Ask AI', actionType: 'ask_ai' }],
      createdAt: Date.now(),
      expiresAt: Date.now() + 10000,
      cooldownKey: 'frustration_support:frustrated',
      sourceRule: 'test',
      dismissible: true,
      channelHints: ['statusBar', 'editorBar'],
      showFeedback: true,
    }

    let received: EmotionFeedbackPayload | null = null
    const unsubscribe = EventBus.on('emotion:feedback', (event) => {
      received = event.feedback
    })

    EventBus.emit({ type: 'emotion:feedback', feedback: payload })

    expect(received).toEqual(payload)
    unsubscribe()
  })
})
