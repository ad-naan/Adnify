import { Bell, CheckCheck, Trash2, Circle } from 'lucide-react'
import { useState } from 'react'
import { t, type Language } from '@shared/i18n'
import { api } from '../../services/electronAPI'
import { useNotifications } from '../../notifications/store'
import { useInlineToast } from '../common/InlineToast'

export default function NotificationCenterContent({ language }: { language: Language }) {
  const records = useNotifications((state) => state.records)
  const { toasts, removeToast } = useInlineToast()
  const [tab, setTab] = useState<'events' | 'local'>('events')
  const [onlyUnread, setOnlyUnread] = useState(false)
  const [actionFailed, setActionFailed] = useState(false)
  const run = (action: Promise<unknown>) => {
    setActionFailed(false)
    void action.catch(() => setActionFailed(true))
  }
  const visible = onlyUnread ? records.filter((record) => !record.read) : records
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border/60">
        <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
          <Bell className="w-3.5 h-3.5" />
          {t('notificationCenterContent.notifications', language)}
        </div>
        <div className="flex items-center gap-3">
          <button
            title={t('notifications.readAll', language)}
            aria-label={t('notifications.readAll', language)}
            onClick={() => run(api.notifications.markRead(records.map((record) => record.event.id)))}
          >
            <CheckCheck className="w-4 h-4 text-text-muted" />
          </button>
          <button
            title={t('notifications.clear', language)}
            aria-label={t('notifications.clear', language)}
            onClick={() => {
              if (tab === 'events') run(api.notifications.clear())
              else toasts.forEach((toast) => removeToast(toast.id))
            }}
          >
            <Trash2 className="w-3.5 h-3.5 text-text-muted" />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-4 px-4 py-3 text-xs border-b border-border/40">
        <button className={tab === 'events' ? 'text-accent' : 'text-text-muted'} onClick={() => setTab('events')}>
          {t('notifications.eventsTab', language)}
        </button>
        <button className={tab === 'local' ? 'text-accent' : 'text-text-muted'} onClick={() => setTab('local')}>
          {t('notifications.localTab', language)}
        </button>
        {tab === 'events' && (
          <label className="ml-auto flex items-center gap-1 text-text-muted">
            <input type="checkbox" checked={onlyUnread} onChange={(event) => setOnlyUnread(event.target.checked)} />
            {t('notifications.unread', language)}
          </label>
        )}
      </div>
      <div className="flex-1 overflow-auto custom-scrollbar p-2 space-y-2">
        {actionFailed && (
          <p role="status" className="text-xs text-status-error p-2">
            {t('notifications.actionFailed', language)}
          </p>
        )}
        {tab === 'events' ? (
          visible.length ? (
            visible.map((record) => (
              <article
                key={record.event.id}
                className={`rounded-lg border p-3 ${record.read ? 'border-border/40 bg-surface/20' : 'border-accent/25 bg-accent/5'}`}
              >
                <button
                  className="text-left w-full"
                  onClick={() =>
                    run(
                      Promise.all([
                        api.notifications.markRead([record.event.id]),
                        api.notifications.activate(record.event.id),
                      ]),
                    )
                  }
                >
                  <div className="flex items-start gap-2">
                    <Circle
                      className={`w-2 h-2 mt-1.5 shrink-0 ${record.event.level === 'error' ? 'fill-status-error text-status-error' : record.event.level === 'warning' ? 'fill-status-warning text-status-warning' : 'fill-accent text-accent'}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-text-primary">{record.event.title}</p>
                      <p className="text-xs text-text-secondary mt-1 break-words">{record.event.message}</p>
                    </div>
                  </div>
                </button>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-muted">
                  <span>{new Date(record.event.timestamp).toLocaleTimeString()}</span>
                  <span className="font-mono">{record.event.type}</span>
                  {Object.entries(record.deliveries).map(([channel, delivery]) => (
                    <span
                      key={channel}
                      title={`${channel}${delivery.error ? `: ${delivery.error}` : ''}`}
                      className={delivery.state === 'failed' ? 'text-status-error' : ''}
                    >
                      {channel === 'inApp'
                        ? t('notifications.eventsTab', language)
                        : channel === 'system'
                          ? t('notifications.system', language)
                          : 'Webhook'}{' '}
                      · {t(`notifications.delivery.${delivery.state}`, language)}
                    </span>
                  ))}
                </div>
              </article>
            ))
          ) : (
            <p className="text-xs text-text-muted text-center py-12">
              {t('notificationCenterContent.noRecords', language)}
            </p>
          )
        ) : toasts.length ? (
          [...toasts].reverse().map((toast) => (
            <article key={toast.id} className="rounded-lg border border-border/40 p-3">
              <p className="text-xs font-semibold text-text-primary">{toast.title}</p>
              <p className="text-xs text-text-secondary whitespace-pre-wrap break-words">{toast.message}</p>
            </article>
          ))
        ) : (
          <p className="text-xs text-text-muted text-center py-12">
            {t('notificationCenterContent.noRecords', language)}
          </p>
        )}
      </div>
    </div>
  )
}
