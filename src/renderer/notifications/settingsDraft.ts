import { t, type Language } from '@shared/i18n'
import type { NotificationFilter, NotificationSettings } from '@shared/types/notifications'

export function prepareNotificationSettings(
  settings: NotificationSettings,
  headers: Record<string, string>,
  language: Language,
): NotificationSettings {
  const checkFilter = (filter: NotificationFilter, name: string) => {
    if (!filter.levels.length) throw new Error(t('notifications.levelRequired', language, { name }))
    if (
      !filter.events.length ||
      filter.events.length > 64 ||
      filter.events.some((pattern) => !/^(?:\*|[a-zA-Z][a-zA-Z0-9_.:-]*(?:\.\*)?)$/.test(pattern))
    ) {
      throw new Error(t('notifications.eventsRequired', language, { name }))
    }
  }
  checkFilter(settings.system, t('notifications.system', language))
  if (!Number.isInteger(settings.cooldownSeconds) || settings.cooldownSeconds < 0 || settings.cooldownSeconds > 3600)
    throw new Error(t('notifications.cooldownInvalid', language))
  return {
    ...settings,
    webhooks: settings.webhooks.map((hook, index) => {
      const name = hook.name.trim() || `Webhook ${index + 1}`
      const url = hook.url.trim()
      if (hook.enabled && !url) throw new Error(t('notifications.urlRequired', language, { name }))
      if (url) {
        let valid = false
        try {
          const parsed = new URL(url)
          valid =
            !parsed.username &&
            !parsed.password &&
            !parsed.hash &&
            (parsed.protocol === 'https:' ||
              (parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)))
        } catch {
          /* Give a field-specific error without echoing the secret URL. */
        }
        if (!valid) throw new Error(t('notifications.urlInvalid', language, { name }))
      }
      let parsedHeaders: unknown
      try {
        parsedHeaders = JSON.parse(headers[hook.id] || '{}')
        if (
          !parsedHeaders ||
          Array.isArray(parsedHeaders) ||
          typeof parsedHeaders !== 'object' ||
          Object.values(parsedHeaders).some((value) => typeof value !== 'string')
        )
          throw new Error()
      } catch {
        throw new Error(t('notifications.headersInvalid', language, { name }))
      }
      try {
        JSON.parse(hook.bodyTemplate)
      } catch {
        throw new Error(t('notifications.bodyInvalid', language, { name }))
      }
      checkFilter(hook, name)
      return { ...hook, name, url, headers: parsedHeaders as Record<string, string> }
    }),
  }
}
