import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotificationService, webhookAccepts } from '@main/services/notifications/NotificationService'
import {
  notificationSettingsSchema,
  defaultNotificationSettings,
  editorEventSchema,
} from '@main/services/notifications/config'
import { renderWebhookBody, sendWebhook, validateWebhook } from '@main/services/notifications/webhook'
import { EditorEventBus } from '@shared/events/EditorEventBus'
import { DEFAULT_WEBHOOK_BODY, type EditorEvent, type WebhookSettings } from '@shared/types/notifications'

const event: EditorEvent = {
  id: 'event-1',
  timestamp: 123,
  type: 'agent.loop.completed',
  title: 'Completed',
  message: 'Open editor',
  level: 'success',
  attention: true,
}
const hook: WebhookSettings = {
  id: 'test-hook',
  name: 'Test',
  enabled: true,
  url: 'https://example.com/hook',
  headers: {},
  bodyTemplate: DEFAULT_WEBHOOK_BODY,
  events: ['agent.*'],
  levels: ['success'],
  includePassive: false,
}
const settle = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve()
}
afterEach(() => {
  vi.useRealTimers()
})

describe('editor event routing', () => {
  it('supports wildcard observers, isolates failures and unsubscribes', () => {
    const bus = new EditorEventBus(),
      seen: string[] = []
    bus.subscribe('*', () => {
      throw new Error('broken observer')
    })
    const remove = bus.subscribe('agent.*', (value) => seen.push(value.type))
    bus.publish(event)
    bus.publish({ ...event, type: 'agentish.event' })
    remove()
    bus.publish(event)
    expect(seen).toEqual(['agent.loop.completed'])
  })

  it('observes passive and repeated events without sending duplicate reminders', async () => {
    const settings = defaultNotificationSettings(),
      changed = vi.fn(),
      seen = vi.fn(),
      deliver = vi.fn(async () => 'delivered' as const)
    settings.webhooks = [hook]
    const service = new NotificationService({ settings: () => settings, changed })
    service.events.subscribe('*', seen)
    service.registerChannel({
      id: hook.id,
      accepts: (value, config) => webhookAccepts(hook.id, value, config),
      deliver,
    })
    service.publish({ ...event, attention: false })
    service.publish(event)
    service.publish(event)
    await settle()
    expect(seen).toHaveBeenCalledTimes(3)
    expect(deliver).toHaveBeenCalledTimes(1)
    expect(service.snapshot().records).toHaveLength(1)
    expect(service.snapshot().records[0].deliveries[hook.id].state).toBe('delivered')
    expect(service.snapshot().records[0].deliveries).not.toHaveProperty('inApp')
    service.stop()
  })

  it('scopes read/clear actions and cooldown to the workspace', () => {
    const settings = defaultNotificationSettings()
    const service = new NotificationService({ settings: () => settings, changed: () => {} })
    service.publish(event, { workspace: 'first' })
    service.publish(event, { workspace: 'second' })
    const ids = service.snapshot().records.map((record) => record.event.id)
    service.markRead(ids, (value) => value.workspace === 'first')
    expect(service.snapshot().records.map((record) => record.read)).toEqual([false, true])
    service.clear((value) => value.workspace === 'first')
    expect(service.snapshot().records[0].event.workspace).toBe('second')
    service.stop()
  })

  it('rechecks queued destinations when disabled or replaced and respects concurrency', async () => {
    const settings = defaultNotificationSettings()
    settings.cooldownSeconds = 0
    settings.webhooks = [structuredClone(hook)]
    const service = new NotificationService({ settings: () => settings, changed: () => {} })
    const releases: Array<() => void> = []
    const deliver = vi.fn(() => new Promise<'delivered'>((resolve) => releases.push(() => resolve('delivered'))))
    service.registerChannel({
      id: hook.id,
      accepts: (value, config) => webhookAccepts(hook.id, value, config),
      deliver,
    })
    for (let i = 0; i < 4; i++) service.publish(event)
    expect(deliver).toHaveBeenCalledTimes(2)
    settings.webhooks[0].enabled = false
    releases.forEach((release) => release())
    await settle()
    expect(deliver).toHaveBeenCalledTimes(2)
    expect(service.snapshot().records.filter((record) => record.deliveries[hook.id].state === 'skipped')).toHaveLength(
      2,
    )
    settings.webhooks[0].enabled = true
    for (let i = 0; i < 3; i++) service.publish(event)
    const replacement = vi.fn(async () => 'delivered' as const)
    service.registerChannel({ id: hook.id, accepts: () => true, deliver: replacement })
    releases.forEach((release) => release())
    await settle()
    expect(replacement).not.toHaveBeenCalled()
    service.stop()
  })

  it('bounds history, times out deliveries and redacts channel errors', async () => {
    vi.useFakeTimers()
    const settings = defaultNotificationSettings()
    settings.cooldownSeconds = 0
    const service = new NotificationService({ settings: () => settings, changed: () => {} })
    service.registerChannel({ id: 'slow', accepts: () => true, deliver: async () => new Promise(() => {}) })
    service.registerChannel({
      id: 'broken',
      accepts: () => true,
      deliver: async () => {
        throw new Error('https://secret.example/?token=private')
      },
    })
    service.publish(event)
    await vi.advanceTimersByTimeAsync(10_001)
    const record = service.snapshot().records[0]
    expect(record.deliveries.slow.state).toBe('failed')
    expect(JSON.stringify(record)).not.toContain('private')
    service.stop()
    const history = new NotificationService({ settings: () => settings, changed: () => {} })
    for (let i = 0; i < 205; i++) history.publish(event)
    expect(history.snapshot().records).toHaveLength(200)
    history.stop()
  })

  it('does not replay pending deliveries after restart or repeat already presented toasts', () => {
    const changed = vi.fn(),
      service = new NotificationService({ settings: defaultNotificationSettings, changed })
    service.publish({ ...event, presented: true })
    expect(changed.mock.calls[0][1]).toBeUndefined()
    const records = service.snapshot().records
    records[0].deliveries.test = { state: 'pending' }
    service.restore(records)
    expect(service.snapshot().records[0].deliveries.test.state).toBe('failed')
    service.stop()
  })
})

describe('webhook transport and configuration', () => {
  it('keeps an empty disabled destination without blocking saves and removes the retired in-app option', () => {
    const input = { ...defaultNotificationSettings(), inApp: true, webhooks: [{ ...hook, url: '', enabled: false }] }
    const saved = notificationSettingsSchema.parse(input)
    expect(saved).not.toHaveProperty('inApp')
    expect(saved.webhooks[0].url).toBe('')
    expect(
      notificationSettingsSchema.safeParse({ ...input, webhooks: [{ ...hook, url: '', enabled: true }] }).success,
    ).toBe(false)
  })

  it('tests system delivery independently of saved filters without enabling or saving the channel', async () => {
    const settings = defaultNotificationSettings()
    settings.system.enabled = false
    settings.system.events = ['index.completed']
    settings.webhooks = [{ ...hook, enabled: false, url: '' }]
    const before = structuredClone(settings),
      deliver = vi.fn(async () => 'delivered' as const)
    const service = new NotificationService({ settings: () => settings, changed: () => {} })
    service.registerChannel({ id: 'system', accepts: () => false, deliver })
    expect(await service.test('system', event, true)).toMatchObject({ success: true })
    expect(deliver.mock.calls[0]).toEqual([
      event,
      expect.objectContaining({ system: expect.objectContaining({ sound: true, onlyWhenUnfocused: false }) }),
      expect.any(AbortSignal),
    ])
    expect(settings).toEqual(before)
    service.stop()
  })
  it('substitutes JSON string values safely and excludes workspace/thread data', () => {
    const result = JSON.parse(
      renderWebhookBody('{"text":"{{title}}: {{message}}","nested":["{{type}}",true,2]}', {
        ...event,
        title: '"},"injected":true,"x":"',
        message: '` ${process.env.SECRET} \\ \n <script>',
        workspace: 'private-path',
        threadId: 'private-thread',
      }),
    )
    expect(result).toEqual({
      text: '"},"injected":true,"x":": ` ${process.env.SECRET} \\ \n <script>',
      nested: [event.type, true, 2],
    })
    expect(JSON.stringify(result)).not.toContain('private')
    expect(() => renderWebhookBody('{"text":"{{workspace}}"}', event)).toThrow()
    expect(() => renderWebhookBody('console.log("run")', event)).toThrow()
  })

  it.each(['http://example.com', 'file:///tmp/private', 'https://user:pass@example.com', 'https://example.com/#token'])(
    'rejects unsafe endpoint %s',
    (url) => {
      expect(() => validateWebhook({ ...hook, url })).toThrow()
    },
  )
  it.each([
    'http://127.0.0.1:1234/hook',
    'http://localhost/hook',
    'http://[::1]:1234/hook',
    'https://example.com/hook',
  ])('supports endpoint %s', (url) => {
    expect(() => validateWebhook({ ...hook, url })).not.toThrow()
  })
  it('rejects reserved/duplicate channel IDs, header injection and oversized or spoofed events', () => {
    const settings = defaultNotificationSettings()
    expect(notificationSettingsSchema.safeParse({ ...settings, webhooks: [{ ...hook, id: 'system' }] }).success).toBe(
      false,
    )
    expect(notificationSettingsSchema.safeParse({ ...settings, webhooks: [hook, hook] }).success).toBe(false)
    expect(() => validateWebhook({ ...hook, headers: { Authorization: 'a\r\nX-Test: injected' } })).toThrow()
    expect(() => validateWebhook({ ...hook, headers: { Cookie: 'ambient=secret' } })).toThrow()
    const { id: _id, timestamp: _time, ...input } = event
    expect(editorEventSchema.safeParse(input).success).toBe(true)
    expect(editorEventSchema.safeParse({ ...input, windowId: 1 }).success).toBe(false)
    expect(editorEventSchema.safeParse({ ...input, message: 'x'.repeat(501) }).success).toBe(false)
  })
  it('omits ambient credentials, refuses redirects, cancels responses and exposes only HTTP status', async () => {
    const cancel = vi.fn(async () => {}),
      fetcher = vi.fn(async () => ({ ok: false, status: 403, body: { cancel } }) as unknown as Response)
    const controller = new AbortController()
    await expect(sendWebhook(hook, event, fetcher, controller.signal)).rejects.toThrow('HTTP 403')
    expect(fetcher).toHaveBeenCalledWith(
      hook.url,
      expect.objectContaining({ method: 'POST', credentials: 'omit', redirect: 'error', signal: controller.signal }),
    )
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})
