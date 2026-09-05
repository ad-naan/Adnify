import { describe, expect, it } from 'vitest'
import { summarizeAgentEvent } from '@renderer/notifications/agentEvents'
import type { LoopEndReason } from '@renderer/agent/core/EventBus'
import { prepareNotificationSettings } from '@renderer/notifications/settingsDraft'
import { NOTIFICATION_EVENT_GROUPS, TASK_RESULT_EVENTS } from '@renderer/notifications/eventCatalog'
import { DEFAULT_NOTIFICATION_SETTINGS, DEFAULT_WEBHOOK_BODY, matchesNotification } from '@shared/types/notifications'
import { notificationSettingsSchema } from '@main/services/notifications/config'

describe('agent notification summaries', () => {
  it.each<[LoopEndReason, boolean, string]>([
    ['complete', true, 'agent.loop.completed'],
    ['tool_requested_stop', true, 'agent.loop.completed'],
    ['error', true, 'agent.loop.failed'],
    ['waiting_for_user', true, 'agent.loop.waiting'],
    ['handoff_required', true, 'agent.loop.waiting'],
    ['aborted', false, 'agent.loop.end'],
    ['user_rejected', false, 'agent.loop.end'],
    ['no_messages', false, 'agent.loop.end'],
  ])('maps %s without falsely announcing completion', (reason, attention, type) => {
    expect(summarizeAgentEvent({ type: 'loop:end', reason, threadId: 'thread', requestId: 'run' }, 'zh')).toMatchObject(
      { type, attention, threadId: 'thread', correlationId: 'run' },
    )
  })
  it('keeps streaming content and tool errors out of push summaries', () => {
    expect(JSON.stringify(summarizeAgentEvent({ type: 'stream:text', text: 'PRIVATE CODE' }, 'en'))).not.toContain(
      'PRIVATE CODE',
    )
    expect(
      JSON.stringify(
        summarizeAgentEvent({ type: 'tool:error', id: 'tool', error: 'https://server?token=SECRET' }, 'en'),
      ),
    ).not.toContain('SECRET')
    expect(
      summarizeAgentEvent({ type: 'tool:pending', id: 'tool', name: 'autoapproved', args: {} }, 'en').attention,
    ).toBe(false)
  })
})

describe('notification setup', () => {
  const settingsWithBlankHook = () => ({
    ...structuredClone(DEFAULT_NOTIFICATION_SETTINGS),
    webhooks: [
      {
        id: 'draft',
        name: 'My tool',
        enabled: false,
        url: '',
        headers: {},
        bodyTemplate: DEFAULT_WEBHOOK_BODY,
        events: ['*'],
        levels: ['success' as const],
        includePassive: false,
      },
    ],
  })
  it('allows unfinished disabled destinations to be saved', () => {
    const result = prepareNotificationSettings(settingsWithBlankHook(), {}, 'zh')
    expect(notificationSettingsSchema.safeParse(result).success).toBe(true)
  })
  it('identifies the failing field and destination without leaking the URL or header values', () => {
    const settings = settingsWithBlankHook()
    settings.webhooks[0].enabled = true
    expect(() => prepareNotificationSettings(settings, {}, 'zh')).toThrow('My tool：请填写')
    settings.webhooks[0].url = 'http://example.com/SECRET'
    expect(() => prepareNotificationSettings(settings, {}, 'en')).toThrow('My tool: use HTTPS')
    settings.webhooks[0].url = 'https://example.com/SECRET'
    expect(() => prepareNotificationSettings(settings, { draft: '{SECRET' }, 'zh')).toThrow('My tool：请求头')
    settings.webhooks[0].bodyTemplate = '{SECRET'
    expect(() => prepareNotificationSettings(settings, {}, 'zh')).toThrow('My tool：消息正文')
  })
  it('keeps every catalog choice valid and covers the task-result preset', () => {
    const patterns = NOTIFICATION_EVENT_GROUPS.flatMap((group) => group.events.map((event) => event.pattern))
    expect(new Set(patterns).size).toBe(patterns.length)
    for (const pattern of TASK_RESULT_EVENTS) expect(patterns).toContain(pattern)
    const settings = structuredClone(DEFAULT_NOTIFICATION_SETTINGS)
    settings.system.events = patterns
    expect(notificationSettingsSchema.safeParse(settings).success).toBe(true)
    const resultFilter = { ...settings.system, events: TASK_RESULT_EVENTS }
    expect(matchesNotification(resultFilter, summarizeAgentEvent({ type: 'loop:end', reason: 'complete' }, 'zh'))).toBe(
      true,
    )
    expect(
      matchesNotification(resultFilter, summarizeAgentEvent({ type: 'stream:text', text: 'progress' }, 'zh')),
    ).toBe(false)
  })
})
