import { useEffect, useState } from 'react'
import { Button, Switch } from '@components/ui'
import { toast } from '@components/common/ToastProvider'
import { t, type Language } from '@shared/i18n'
import { backgroundTaskSettings } from '@renderer/backgroundTasks/settings'
import { useBackgroundConnections } from '@renderer/backgroundTasks/connections'
import { api } from '@renderer/services/electronAPI'

const options = [
  ['taskbarProgress', 'backgroundTasks.taskbar', 'backgroundTasks.taskbarHint'],
  ['preventIdleSleep', 'backgroundTasks.preventSleep', 'backgroundTasks.preventSleepHint'],
  ['checkConnectionsOnResume', 'backgroundTasks.resumeCheck', 'backgroundTasks.resumeCheckHint'],
] as const

export function BackgroundTaskSettings({ language }: { language: Language }) {
  const [settings, setSettings] = useState(() => backgroundTaskSettings.load())
  const { checking, report } = useBackgroundConnections()
  const [pending, setPending] = useState(false)
  useEffect(() => {
    const unsubscribe = backgroundTaskSettings.subscribe(setSettings)
    setSettings(backgroundTaskSettings.load())
    return unsubscribe
  }, [])

  const check = async (serverId?: string) => {
    if (pending || checking) return
    setPending(true)
    try {
      if (serverId) await api.mcp.reconnectServer(serverId)
      const state = await api.backgroundTasks.check()
      if (typeof state.checking !== 'boolean') throw new Error('Connection check failed')
      useBackgroundConnections.setState(state)
    } catch {
      toast.error(t('backgroundTasks.checkFailed', language))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="rounded-xl border border-border/70 bg-surface/25 p-5 space-y-4">
      <div>
        <div className="text-sm font-bold text-text-primary">{t('backgroundTasks.title', language)}</div>
        <p className="text-xs text-text-muted mt-1 leading-relaxed">{t('backgroundTasks.description', language)}</p>
      </div>
      {options.map(([key, label, hint]) => (
        <div key={key} className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs text-text-secondary">{t(label, language)}</div>
            <p className="text-xs text-text-muted mt-1 leading-relaxed">{t(hint, language)}</p>
          </div>
          <Switch checked={settings[key]} aria-label={t(label, language)}
            onChange={event => backgroundTaskSettings.update({ [key]: event.target.checked })} />
        </div>
      ))}
      <div className="border-t border-border/50 pt-4 space-y-2" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-text-muted">{checking ? t('backgroundTasks.checking', language)
            : report ? t('backgroundTasks.checkedAt', language, { time: new Date(report.checkedAt).toLocaleTimeString() })
              : t('backgroundTasks.notChecked', language)}</span>
          <Button variant="secondary" size="sm" disabled={pending || checking} onClick={() => void check()}>
            {t('backgroundTasks.recheck', language)}
          </Button>
        </div>
        {report && <>
          <p className={`text-xs ${report.model === 'unreachable' ? 'text-status-warning' : 'text-text-secondary'}`}>
            {t(report.model === 'reachable' ? 'backgroundTasks.modelReachable'
              : report.model === 'unreachable' ? 'backgroundTasks.modelUnreachable' : 'backgroundTasks.modelUnconfigured', language)}
          </p>
          <p className="text-xs text-text-secondary">{t('backgroundTasks.mcpChecked', language, { count: report.mcp.checked })}</p>
          {report.mcp.failed.map(server => <div key={server.id} className="flex items-center justify-between gap-3">
            <span className="text-xs text-status-warning break-all">{t('backgroundTasks.mcpFailed', language, { name: server.name })}</span>
            <Button variant="secondary" size="sm" disabled={pending || checking} onClick={() => void check(server.id)}>
              {t('backgroundTasks.reconnect', language)}
            </Button>
          </div>)}
          {report.checkFailed && <p className="text-xs text-status-warning">{t('backgroundTasks.checkFailed', language)}</p>}
        </>}
      </div>
    </div>
  )
}
