import { randomUUID } from 'node:crypto'
import { EditorEventBus } from '@shared/events/EditorEventBus'
import {
  matchesNotification,
  type EditorEvent,
  type EditorEventInput,
  type NotificationSettings,
  type NotificationRecord,
  type NotificationSnapshot,
} from '@shared/types/notifications'

export interface NotificationChannel {
  id: string
  accepts: (event: EditorEvent, settings: NotificationSettings) => boolean
  deliver: (event: EditorEvent, settings: NotificationSettings, signal: AbortSignal) => Promise<'delivered' | 'skipped'>
}
export class NotificationService {
  readonly events = new EditorEventBus<EditorEvent>()
  private channels = new Map<string, NotificationChannel>()
  private records: NotificationRecord[] = []
  private recent = new Map<string, number>()
  private revision = 0
  private active = 0
  private queue: Array<() => Promise<void>> = []
  private controllers = new Set<AbortController>()
  private stopped = false
  constructor(
    private options: {
      settings: () => NotificationSettings
      changed: (snapshot: NotificationSnapshot) => void
    },
  ) {}
  registerChannel(channel: NotificationChannel): () => void {
    this.channels.set(channel.id, channel)
    return () => {
      if (this.channels.get(channel.id) === channel) this.channels.delete(channel.id)
    }
  }
  snapshot(): NotificationSnapshot {
    return structuredClone({ revision: this.revision, records: this.records })
  }
  restore(records: NotificationRecord[]): void {
    this.records = records.slice(0, 200).map((record) => ({
      ...record,
      deliveries: Object.fromEntries(
        Object.entries(record.deliveries).map(([id, status]) => [
          id,
          status.state === 'pending' ? { state: 'failed' as const, error: 'Interrupted by application exit' } : status,
        ]),
      ),
    }))
    this.changed()
  }
  private changed(): void {
    this.revision++
    this.options.changed(this.snapshot())
  }
  publish(input: EditorEventInput, context: { windowId?: number; workspace?: string } = {}): void {
    if (this.stopped) return
    const event: EditorEvent = { ...input, ...context, id: randomUUID(), timestamp: Date.now() }
    this.events.publish(event)
    const settings = this.options.settings()
    const channels = [...this.channels.values()].filter((channel) => channel.accepts(event, settings))
    if (!event.attention && channels.length === 0) return
    const signature = JSON.stringify([
      event.type,
      event.windowId,
      event.workspace,
      event.correlationId ?? event.threadId ?? event.message,
    ])
    const previous = this.recent.get(signature)
    if (previous !== undefined && event.timestamp - previous < settings.cooldownSeconds * 1000) return
    this.recent.set(signature, event.timestamp)
    while (this.recent.size > 1000) this.recent.delete(this.recent.keys().next().value!)
    const record: NotificationRecord = { event, read: false, deliveries: {} }
    for (const channel of channels) record.deliveries[channel.id] = { state: 'pending' }
    this.records.unshift(record)
    this.records.length = Math.min(this.records.length, 200)
    this.changed()
    for (const channel of channels) {
      if (this.queue.length + this.active >= 64) {
        record.deliveries[channel.id] = { state: 'failed', error: 'Notification queue is full' }
        this.changed()
        continue
      }
      this.queue.push(async () => {
        // Re-read settings before sending: disabling/removing a destination cancels queued delivery.
        const current = this.options.settings()
        if (this.channels.get(channel.id) !== channel || !channel.accepts(event, current)) {
          record.deliveries[channel.id] = { state: 'skipped' }
          this.changed()
          return
        }
        record.deliveries[channel.id] = await this.deliver(channel, event, current)
        this.changed()
      })
    }
    this.drain()
  }
  private drain(): void {
    while (!this.stopped && this.active < 2 && this.queue.length) {
      const work = this.queue.shift()!
      this.active++
      void work()
        .catch(() => {})
        .finally(() => {
          this.active--
          this.drain()
        })
    }
  }
  private async deliver(
    channel: NotificationChannel,
    event: EditorEvent,
    settings: NotificationSettings,
  ): Promise<NotificationRecord['deliveries'][string]> {
    const controller = new AbortController()
    this.controllers.add(controller)
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const aborted = new Promise<never>((_resolve, reject) =>
        controller.signal.addEventListener('abort', () => reject(new Error('Delivery timed out or stopped')), {
          once: true,
        }),
      )
      const state = await Promise.race([channel.deliver(event, settings, controller.signal), aborted])
      return { state }
    } catch (error) {
      // URLs, response bodies and request headers may contain credentials. Never save them.
      const message =
        error instanceof Error && /^HTTP \d{3}$/.test(error.message) ? error.message : 'Delivery failed or timed out'
      return { state: 'failed', error: message }
    } finally {
      clearTimeout(timer)
      this.controllers.delete(controller)
    }
  }
  async test(channelId: string, event: EditorEvent, sound?: boolean): Promise<{ success: boolean; error?: string }> {
    const channel = this.channels.get(channelId)
    if (!channel || this.stopped || this.active >= 2) return { success: false, error: 'Channel unavailable or busy' }
    this.active++
    try {
      const settings = this.options.settings()
      const result = await this.deliver(
        channel,
        event,
        channelId === 'system'
          ? {
              ...settings,
              system: { ...settings.system, onlyWhenUnfocused: false, sound: sound ?? settings.system.sound },
            }
          : settings,
      )
      return {
        success: result.state === 'delivered',
        error: result.error ?? (result.state === 'skipped' ? 'System notifications unavailable' : undefined),
      }
    } finally {
      this.active--
      this.drain()
    }
  }
  markRead(ids: string[], visible: (event: EditorEvent) => boolean): void {
    for (const record of this.records) if (visible(record.event) && ids.includes(record.event.id)) record.read = true
    this.changed()
  }
  clear(visible: (event: EditorEvent) => boolean): void {
    this.records = this.records.filter((record) => !visible(record.event))
    this.changed()
  }
  stop(): void {
    this.stopped = true
    this.queue = []
    for (const controller of this.controllers) controller.abort()
  }
}

export function webhookAccepts(id: string, event: EditorEvent, settings: NotificationSettings): boolean {
  const webhook = settings.webhooks.find((item) => item.id === id)
  return !!webhook?.enabled && matchesNotification(webhook, event)
}
