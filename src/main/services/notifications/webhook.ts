import { validateHeaderName, validateHeaderValue } from 'node:http'
import type { EditorEvent, WebhookSettings } from '@shared/types/notifications'

const placeholders = new Set(['id', 'type', 'title', 'message', 'level', 'timestamp'])
export function renderWebhookBody(template: string, event: EditorEvent): string {
  const visit = (value: unknown, depth: number): unknown => {
    if (depth > 12) throw new Error('Webhook JSON is too deeply nested')
    if (typeof value === 'string')
      return value.replace(/\{\{([a-zA-Z]+)\}\}/g, (_match, key: string) => {
        if (!placeholders.has(key)) throw new Error(`Unsupported placeholder: ${key}`)
        return String(event[key as keyof EditorEvent] ?? '')
      })
    if (Array.isArray(value)) return value.map((item) => visit(item, depth + 1))
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, depth + 1)]))
    return value
  }
  return JSON.stringify(visit(JSON.parse(template), 0))
}
export function validateWebhook(config: WebhookSettings): void {
  const url = new URL(config.url)
  // Local HTTP receivers are useful for automation bridges; remote endpoints use TLS.
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  ) {
    throw new Error('Use HTTPS, or HTTP on localhost')
  }
  if (url.username || url.password || url.hash) throw new Error('URL credentials and fragments are unsupported')
  for (const [name, value] of Object.entries(config.headers)) {
    validateHeaderName(name)
    validateHeaderValue(name, value)
    if (['host', 'content-length', 'connection', 'transfer-encoding', 'cookie'].includes(name.toLowerCase()))
      throw new Error('Unsupported webhook header')
  }
  renderWebhookBody(config.bodyTemplate, {
    id: 'test',
    type: 'notification.test',
    title: 'Test',
    message: 'Test',
    level: 'info',
    timestamp: 0,
  })
}
export async function sendWebhook(
  config: WebhookSettings,
  event: EditorEvent,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<void> {
  validateWebhook(config)
  const response = await fetcher(config.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...config.headers },
    body: renderWebhookBody(config.bodyTemplate, event),
    signal,
    redirect: 'error',
    credentials: 'omit',
  })
  await response.body?.cancel()
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
}
