import { z } from 'zod'
import { DEFAULT_NOTIFICATION_SETTINGS } from '@shared/types/notifications'
import { validateWebhook } from './webhook'

const text = z.string().max(500)
const filter = {
  events: z
    .array(
      z
        .string()
        .min(1)
        .max(120)
        .regex(/^(?:\*|[a-zA-Z][a-zA-Z0-9_.:-]*(?:\.\*)?)$/),
    )
    .min(1)
    .max(64),
  levels: z
    .array(z.enum(['info', 'success', 'warning', 'error']))
    .min(1)
    .max(4),
  includePassive: z.boolean(),
}
export const notificationSettingsSchema = z
  .object({
    // Accept and discard the retired in-editor alert setting from older profiles.
    inApp: z.boolean().optional(),
    cooldownSeconds: z.number().int().min(0).max(3600),
    system: z.object({ ...filter, enabled: z.boolean(), onlyWhenUnfocused: z.boolean(), sound: z.boolean() }).strict(),
    webhooks: z
      .array(
        z
          .object({
            ...filter,
            id: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/),
            name: z.string().min(1).max(80),
            enabled: z.boolean(),
            url: z.string().trim().max(4096),
            headers: z.record(z.string().max(8000)).refine((value) => Object.keys(value).length <= 20),
            bodyTemplate: z.string().min(1).max(16000),
          })
          .strict(),
      )
      .max(5),
  })
  .strict()
  .superRefine((settings, ctx) => {
    if (new Set(settings.webhooks.map((item) => item.id)).size !== settings.webhooks.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate webhook IDs' })
    for (const hook of settings.webhooks) {
      if (['system', 'inApp'].includes(hook.id)) ctx.addIssue({ code: 'custom', message: 'Reserved channel ID' })
      if (!hook.enabled && !hook.url) continue
      try {
        validateWebhook(hook)
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Invalid webhook URL, headers or JSON template' })
      }
    }
  })
  .transform(({ inApp: _legacy, ...settings }) => settings)
export const editorEventSchema = z
  .object({
    type: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-zA-Z][a-zA-Z0-9_.:-]*$/),
    title: z.string().min(1).max(120),
    message: text,
    level: z.enum(['info', 'success', 'warning', 'error']),
    attention: z.boolean().optional(),
    correlationId: z.string().max(200).optional(),
    threadId: z.string().max(200).optional(),
    presented: z.boolean().optional(),
  })
  .strict()
export function defaultNotificationSettings() {
  return structuredClone(DEFAULT_NOTIFICATION_SETTINGS)
}
