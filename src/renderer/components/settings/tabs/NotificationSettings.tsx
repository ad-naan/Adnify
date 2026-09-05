import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { Bell, Plus, Trash2 } from 'lucide-react'
import { Button, Input, Switch } from '../../ui'
import { api } from '../../../services/electronAPI'
import { NotificationEventFilter } from './NotificationEventFilter'
import { prepareNotificationSettings } from '../../../notifications/settingsDraft'
import { t, type Language } from '@shared/i18n'
import {
  DEFAULT_WEBHOOK_BODY,
  type NotificationSettings as Settings,
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
  const [systemStatus, setSystemStatus] = useState('')
  const [systemFailed, setSystemFailed] = useState(false)
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
    if (channel === 'system') {
      setSystemStatus('')
      setSystemFailed(false)
      try {
        // Test the OS directly; unrelated drafts must never block this action.
        const result = await api.notifications.test('system', { sound: settings.system.sound })
        setSystemFailed(!result.success)
        setSystemStatus(t(result.success ? 'notifications.systemAccepted' : 'notifications.systemTestFailed', language))
        return result.success
      } catch {
        setSystemFailed(true)
        setSystemStatus(t('notifications.systemTestFailed', language))
        return false
      } finally {
        setBusy(false)
      }
    }
    setStatus('')
    setFailed(false)
    try {
      let next: Settings
      try {
        const target = settings.webhooks.find((hook) => hook.id === channel)
        if (target && !target.url.trim())
          throw new Error(t('notifications.urlRequired', language, { name: target.name || 'Webhook' }))
        next = prepareNotificationSettings(settings, headers, language)
      } catch (error) {
        setFailed(true)
        setStatus((error as Error).message)
        return false
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
          <p className="text-xs text-text-muted">{t('notifications.setupHelp', language)}</p>
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
                <NotificationEventFilter
                  language={language}
                  value={settings.system}
                  onChange={(patch) => setSettings({ ...settings, system: { ...settings.system, ...patch } })}
                />
              </div>
            </details>
            {!settings.system.enabled && (
              <p className="text-xs text-status-warning">{t('notifications.systemDisabled', language)}</p>
            )}
            <Button size="sm" variant="secondary" onClick={() => void run('system')}>
              {t('notifications.testSystem', language)}
            </Button>
            {systemStatus && (
              <p role="status" className={`text-xs ${systemFailed ? 'text-status-error' : 'text-text-secondary'}`}>
                {systemStatus}
              </p>
            )}
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
            <p className="text-xs text-text-secondary leading-relaxed">{t('notifications.webhookSetup', language)}</p>
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
                <label className="block text-xs text-text-secondary">
                  {t('notifications.webhookUrl', language)}
                  <Input
                    aria-label="Webhook URL"
                    type="password"
                    autoComplete="off"
                    value={hook.url}
                    placeholder="https://…"
                    onChange={(event) => updateHook(hook.id, { url: event.target.value })}
                  />
                </label>
                <NotificationEventFilter
                  language={language}
                  value={hook}
                  onChange={(patch) => updateHook(hook.id, patch)}
                />
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
