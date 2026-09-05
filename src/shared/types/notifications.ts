export type NotificationLevel = 'info' | 'success' | 'warning' | 'error'
export const NOTIFICATION_LEVELS: NotificationLevel[] = ['info', 'success', 'warning', 'error']

/** Summaries only: never put source code, prompts, tool arguments or credentials here. */
export interface EditorEventInput {
  type: string
  title: string
  message: string
  level: NotificationLevel
  attention?: boolean
  correlationId?: string
  threadId?: string
  /** Existing UI already displayed this event. */
  presented?: boolean
}
export interface EditorEvent extends EditorEventInput {
  id: string
  timestamp: number
  windowId?: number
  workspace?: string
}
export interface NotificationFilter {
  events: string[]
  levels: NotificationLevel[]
  includePassive: boolean
}
export interface WebhookSettings extends NotificationFilter {
  id: string
  name: string
  enabled: boolean
  url: string
  headers: Record<string, string>
  /** JSON with placeholders inside string values; never executable code. */
  bodyTemplate: string
}
export interface NotificationSettings {
  cooldownSeconds: number
  system: NotificationFilter & { enabled: boolean; onlyWhenUnfocused: boolean; sound: boolean }
  webhooks: WebhookSettings[]
}
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  cooldownSeconds: 15,
  system: {
    enabled: true,
    onlyWhenUnfocused: true,
    sound: false,
    events: ['*'],
    levels: ['success', 'warning', 'error'],
    includePassive: false,
  },
  webhooks: [],
}
export const DEFAULT_WEBHOOK_BODY =
  '{\n  "event": "{{type}}",\n  "title": "{{title}}",\n  "message": "{{message}}",\n  "level": "{{level}}",\n  "id": "{{id}}",\n  "timestamp": "{{timestamp}}"\n}'
export type DeliveryState = 'pending' | 'delivered' | 'failed' | 'skipped'
export interface NotificationRecord {
  event: EditorEvent
  read: boolean
  deliveries: Record<string, { state: DeliveryState; error?: string }>
}
export interface NotificationSnapshot {
  revision: number
  records: NotificationRecord[]
}
export interface NotificationAPI {
  publish: (events: EditorEventInput[]) => Promise<void>
  history: () => Promise<NotificationSnapshot>
  settings: () => Promise<NotificationSettings>
  saveSettings: (settings: NotificationSettings) => Promise<NotificationSettings>
  markRead: (ids: string[]) => Promise<void>
  clear: () => Promise<void>
  activate: (id: string) => Promise<void>
  test: (channel: string, options?: { sound: boolean }) => Promise<{ success: boolean; error?: string }>
  onActivate: (callback: (event: EditorEvent) => void) => () => void
  /** History invalidation only; this never asks the renderer to show a notification. */
  onChanged: (callback: () => void) => () => void
}

export function matchesEvent(pattern: string, type: string): boolean {
  if (pattern === '*') return true
  return pattern.endsWith('.*') ? type.startsWith(pattern.slice(0, -1)) : pattern === type
}
export function matchesNotification(filter: NotificationFilter, event: EditorEventInput): boolean {
  return (
    (event.attention === true || filter.includePassive) &&
    filter.levels.includes(event.level) &&
    filter.events.some((pattern) => matchesEvent(pattern, event.type))
  )
}
