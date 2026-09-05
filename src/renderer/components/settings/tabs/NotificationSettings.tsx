import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { Bell, Plus, Trash2 } from 'lucide-react'
import { Button, Input, Switch } from '../../ui'
import { api } from '../../../services/electronAPI'
import { t, type Language } from '@shared/i18n'
import {
  DEFAULT_WEBHOOK_BODY,
  NOTIFICATION_LEVELS,
  type NotificationSettings as Settings,
  type NotificationFilter,
  type WebhookSettings,
} from '@shared/types/notifications'

export interface NotificationSettingsHandle {
  save: () => Promise<boolean>
}
function draftSnapshot(settings: Settings, headers: Record<string, string>): string {
  return JSON.stringify({
    ...settings,
    webhooks: settings.webhooks.map((hook) => ({ ...hook, headers: headers[hook.id] ?? '{}' })),
  })
}
export const NotificationSettings = forwardRef<
  NotificationSettingsHandle,
  { language: Language; onDirtyChange?: (dirty: boolean) => void }
>(function NotificationSettings({ language, onDirtyChange }, ref) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [headers, setHeaders] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [failed, setFailed] = useState(false)
  const [baseline, setBaseline] = useState('')
  const dirty = !!settings && draftSnapshot(settings, headers) !== baseline
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => {
    let disposed = false
    void api.notifications
      .settings()
      .then((value) => {
        if (disposed) return
        setSettings(value)
        const nextHeaders = Object.fromEntries(
          value.webhooks.map((hook) => [hook.id, JSON.stringify(hook.headers, null, 2)]),
        )
        setHeaders(nextHeaders)
        setBaseline(draftSnapshot(value, nextHeaders))
      })
      .catch(() => {
        if (!disposed) {
          setFailed(true)
          setStatus(t('notifications.loadFailed', language))
        }
      })
    return () => {
      disposed = true
    }
  }, [language])
  const updateHook = (id: string, patch: Partial<WebhookSettings>) =>
    setSettings(
      (value) =>
        value && { ...value, webhooks: value.webhooks.map((hook) => (hook.id === id ? { ...hook, ...patch } : hook)) },
    )
  const run = async (channel?: string) => {
    if (!settings || busy) return false
    setBusy(true)
    setStatus('')
    setFailed(false)
    try {
      const next = {
        ...settings,
        webhooks: settings.webhooks.map((hook) => ({ ...hook, headers: JSON.parse(headers[hook.id] || '{}') })),
      }
      const saved = await api.notifications.saveSettings(next)
      setSettings(saved)
      setBaseline(draftSnapshot(saved, headers))
      if (channel) {
        const result = await api.notifications.test(channel)
        if (!result.success) throw new Error(result.error)
      }
      setStatus(t(channel ? 'notifications.testSuccess' : 'notifications.saved', language))
      return true
    } catch {
      setFailed(true)
      setStatus(t(channel ? 'notifications.testFailed' : 'notifications.saveFailed', language))
      return false
    } finally {
      setBusy(false)
    }
  }
  useImperativeHandle(ref, () => ({ save: () => run() }))
  const filter = (value: NotificationFilter, update: (patch: Partial<NotificationFilter>) => void) => (
    <div className="space-y-3">
      <label className="block text-xs text-text-secondary">
        {t('notifications.events', language)}
        <Input
          className="mt-2 font-mono text-xs"
          value={value.events.join(', ')}
          onChange={(event) => update({ events: event.target.value.split(',').map((item) => item.trim()) })}
        />
      </label>
      <p className="text-xs text-text-muted">{t('notifications.eventsHint', language)}</p>
      <div className="flex flex-wrap gap-4">
        {NOTIFICATION_LEVELS.map((level) => (
          <label key={level} className="flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={value.levels.includes(level)}
              onChange={(event) =>
                update({
                  levels: event.target.checked
                    ? [...value.levels, level]
                    : value.levels.filter((item) => item !== level),
                })
              }
            />
            {t(`notifications.level.${level}`, language)}
          </label>
        ))}
      </div>
      <label className="flex items-center justify-between gap-4 text-xs text-text-secondary">
        {t('notifications.passive', language)}
        <Switch checked={value.includePassive} onChange={(event) => update({ includePassive: event.target.checked })} />
      </label>
    </div>
  )
  return (
    <section className="rounded-xl border border-border/70 bg-surface/25 p-5 space-y-5">
      {!onDirtyChange && (
        <div className="flex items-start gap-3">
          <Bell className="w-4 h-4 text-accent mt-0.5" />
          <div>
            <h3 className="text-sm font-bold text-text-primary">{t('notifications.settingsTitle', language)}</h3>
            <p className="mt-1 text-xs text-text-muted leading-relaxed">
              {t('notifications.settingsDescription', language)}
            </p>
          </div>
        </div>
      )}
      {settings && (
        <fieldset disabled={busy} className="space-y-5 disabled:opacity-60">
          <label className="flex items-center justify-between text-xs text-text-secondary">
            {t('notifications.inApp', language)}
            <Switch
              checked={settings.inApp}
              onChange={(event) => setSettings({ ...settings, inApp: event.target.checked })}
            />
          </label>
          <label className="flex items-center justify-between gap-4 text-xs text-text-secondary">
            {t('notifications.cooldown', language)}
            <span className="w-24 shrink-0">
              <Input
                aria-label={t('notifications.cooldown', language)}
                type="number"
                min={0}
                max={3600}
                value={settings.cooldownSeconds}
                onChange={(event) => setSettings({ ...settings, cooldownSeconds: Number(event.target.value) })}
              />
            </span>
          </label>
          <div className="border-t border-border/50 pt-4 space-y-4">
            <label className="flex items-center justify-between text-xs font-semibold text-text-primary">
              {t('notifications.system', language)}
              <Switch
                checked={settings.system.enabled}
                onChange={(event) =>
                  setSettings({ ...settings, system: { ...settings.system, enabled: event.target.checked } })
                }
              />
            </label>
            <label className="flex items-center justify-between text-xs text-text-secondary">
              {t('notifications.unfocusedOnly', language)}
              <Switch
                checked={settings.system.onlyWhenUnfocused}
                onChange={(event) =>
                  setSettings({ ...settings, system: { ...settings.system, onlyWhenUnfocused: event.target.checked } })
                }
              />
            </label>
            <label className="flex items-center justify-between text-xs text-text-secondary">
              {t('notifications.sound', language)}
              <Switch
                checked={settings.system.sound}
                onChange={(event) =>
                  setSettings({ ...settings, system: { ...settings.system, sound: event.target.checked } })
                }
              />
            </label>
            <details>
              <summary className="text-xs text-text-muted cursor-pointer">
                {t('notifications.filters', language)}
              </summary>
              <div className="mt-3">
                {filter(settings.system, (patch) =>
                  setSettings({ ...settings, system: { ...settings.system, ...patch } }),
                )}
              </div>
            </details>
            <Button size="sm" variant="secondary" onClick={() => void run('system')}>
              {t('notifications.testSystem', language)}
            </Button>
          </div>
          <div className="border-t border-border/50 pt-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text-primary">Webhook</span>
              <Button
                variant="secondary"
                size="sm"
                disabled={settings.webhooks.length >= 5}
                onClick={() => {
                  const id = crypto.randomUUID()
                  setSettings({
                    ...settings,
                    webhooks: [
                      ...settings.webhooks,
                      {
                        id,
                        name: 'Webhook',
                        enabled: false,
                        url: '',
                        headers: {},
                        bodyTemplate: DEFAULT_WEBHOOK_BODY,
                        events: ['*'],
                        levels: ['success', 'warning', 'error'],
                        includePassive: false,
                      },
                    ],
                  })
                  setHeaders((value) => ({ ...value, [id]: '{}' }))
                }}
              >
                <Plus className="w-3 h-3 mr-1" />
                {t('notifications.addWebhook', language)}
              </Button>
            </div>
            <p className="text-xs text-text-muted leading-relaxed">{t('notifications.webhookHint', language)}</p>
            {settings.webhooks.map((hook) => (
              <div key={hook.id} className="rounded-lg border border-border/60 p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <Input
                    aria-label={t('notifications.destinationName', language)}
                    value={hook.name}
                    onChange={(event) => updateHook(hook.id, { name: event.target.value })}
                  />
                  <Switch
                    aria-label={t('notifications.enableWebhook', language)}
                    checked={hook.enabled}
                    onChange={(event) => updateHook(hook.id, { enabled: event.target.checked })}
                  />
                  <button
                    aria-label={t('notifications.removeWebhook', language)}
                    onClick={() =>
                      setSettings({ ...settings, webhooks: settings.webhooks.filter((item) => item.id !== hook.id) })
                    }
                  >
                    <Trash2 className="w-4 h-4 text-text-muted" />
                  </button>
                </div>
                <Input
                  aria-label="Webhook URL"
                  type="password"
                  autoComplete="off"
                  value={hook.url}
                  placeholder="https://…"
                  onChange={(event) => updateHook(hook.id, { url: event.target.value })}
                />
                {filter(hook, (patch) => updateHook(hook.id, patch))}
                <details>
                  <summary className="text-xs text-text-muted cursor-pointer">
                    {t('notifications.headers', language)}
                  </summary>
                  <textarea
                    aria-label={t('notifications.headers', language)}
                    spellCheck={false}
                    className="w-full mt-2 p-3 rounded-lg bg-background border border-border text-xs font-mono"
                    rows={3}
                    value={headers[hook.id] ?? '{}'}
                    onChange={(event) => setHeaders((value) => ({ ...value, [hook.id]: event.target.value }))}
                  />
                </details>
                <details>
                  <summary className="text-xs text-text-muted cursor-pointer">
                    {t('notifications.body', language)}
                  </summary>
                  <textarea
                    aria-label={t('notifications.body', language)}
                    spellCheck={false}
                    className="w-full mt-2 p-3 rounded-lg bg-background border border-border text-xs font-mono"
                    rows={8}
                    value={hook.bodyTemplate}
                    onChange={(event) => updateHook(hook.id, { bodyTemplate: event.target.value })}
                  />
                  <p className="text-xs text-text-muted mt-2">
                    {'{{type}} · {{title}} · {{message}} · {{level}} · {{id}} · {{timestamp}}'}
                  </p>
                </details>
                <Button size="sm" variant="secondary" onClick={() => void run(hook.id)}>
                  {t('notifications.testWebhook', language)}
                </Button>
              </div>
            ))}
          </div>
          {!onDirtyChange && (
            <Button size="sm" onClick={() => void run()}>
              {t('notifications.save', language)}
            </Button>
          )}
        </fieldset>
      )}
      {status && (
        <p role="status" className={`text-xs ${failed ? 'text-status-error' : 'text-status-success'}`}>
          {status}
        </p>
      )}
    </section>
  )
})
