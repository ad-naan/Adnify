import { Bell, CheckCheck, Trash2, Circle, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { t, toLocaleTag, type Language, type TranslationKey } from '@shared/i18n'
import type { DeliveryState, NotificationRecord } from '@shared/types/notifications'
import { api } from '../../services/electronAPI'
import { useInlineToast } from '../common/InlineToast'
const deliveryKeys: Record<DeliveryState, TranslationKey> = {
  pending: 'messageCenter.delivery.pending', delivered: 'messageCenter.delivery.delivered',
  failed: 'messageCenter.delivery.failed', skipped: 'messageCenter.delivery.skipped',
}

export default function NotificationCenterContent({ language, records, failed, refresh }: {
  language: Language; records: NotificationRecord[]; failed: boolean; refresh: () => void
}) {
  const { toasts, removeToast } = useInlineToast()
  const [tab, setTab] = useState<'events' | 'local'>('local')
  const [onlyUnread, setOnlyUnread] = useState(false)
  const [actionFailed, setActionFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<unknown>) => {
    setActionFailed(false); setBusy(true)
    try { await action(); refresh() } catch { setActionFailed(true) } finally { setBusy(false) }
  }
  const visible = onlyUnread ? records.filter(record => !record.read) : records
  const actionClass = 'rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text-primary disabled:opacity-40'
  return <section className="flex h-full flex-col" aria-label={t('messageCenter.title', language)}>
    <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
      <h3 className="flex items-center gap-2 text-xs font-semibold text-text-primary"><Bell className="h-3.5 w-3.5" />{t('messageCenter.title', language)}</h3>
      <div className="flex items-center gap-2">
        {tab === 'events' && <button className={actionClass} disabled={busy || !records.some(record => !record.read)} title={t('messageCenter.readAll', language)} aria-label={t('messageCenter.readAll', language)} onClick={() => void run(() => api.notifications.markRead(records.filter(record => !record.read).map(record => record.event.id)))}><CheckCheck className="h-4 w-4" /></button>}
        <button className={actionClass} disabled={busy || (tab === 'events' ? !records.length : !toasts.length)} title={t('messageCenter.clear', language)} aria-label={t('messageCenter.clear', language)} onClick={() => {
          if (tab === 'events') void run(() => api.notifications.clear())
          else toasts.forEach(toast => removeToast(toast.id))
        }}><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
    </div>
    <nav className="flex items-center gap-4 border-b border-border/40 px-4 py-3 text-xs" aria-label={t('messageCenter.tabs', language)}>
      <button className={tab === 'local' ? 'text-accent' : 'text-text-muted'} aria-pressed={tab === 'local'} onClick={() => setTab('local')}>{t('messageCenter.local', language)}</button>
      <button className={tab === 'events' ? 'text-accent' : 'text-text-muted'} aria-pressed={tab === 'events'} onClick={() => setTab('events')}>{t('messageCenter.events', language)}</button>
      {tab === 'events' && <label className="ml-auto flex items-center gap-1 text-text-muted"><input type="checkbox" checked={onlyUnread} onChange={event => setOnlyUnread(event.target.checked)} />{t('messageCenter.unread', language)}</label>}
    </nav>
    <div className="custom-scrollbar min-h-0 flex-1 space-y-2 overflow-auto p-2">
      {(actionFailed || failed && tab === 'events') && <div className="flex items-center justify-between gap-2 p-2 text-xs text-status-error" role="alert"><span>{t('messageCenter.failed', language)}</span><button className={actionClass} onClick={refresh} aria-label={t('messageCenter.retry', language)}><RefreshCw size={14} /></button></div>}
      {tab === 'local' && [...toasts].reverse().map(toast => <article key={toast.id} className="space-y-1 rounded-lg border border-border/40 p-3">
        {toast.title && <p className="text-xs font-semibold text-text-primary">{toast.title}</p>}
        <p className="whitespace-pre-wrap break-words text-xs text-text-secondary">{toast.message}</p>
        <time className="text-[10px] text-text-muted">{new Date(toast.timestamp).toLocaleTimeString(toLocaleTag(language))}</time>
      </article>)}
      {tab === 'events' && visible.map(record => <article key={record.event.id} className={`rounded-lg border p-3 ${record.read ? 'border-border/40 bg-surface/20' : 'border-accent/25 bg-accent/5'}`}>
        <button className="w-full text-left" disabled={busy} onClick={() => void run(() => api.notifications.activate(record.event.id))}>
          <div className="flex items-start gap-2">
            <Circle className={`mt-1.5 h-2 w-2 shrink-0 ${record.event.level === 'error' ? 'fill-status-error text-status-error' : record.event.level === 'warning' ? 'fill-status-warning text-status-warning' : 'fill-accent text-accent'}`} />
            <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-text-primary">{record.event.title}</p><p className="mt-1 break-words text-xs text-text-secondary">{record.event.message}</p></div>
          </div>
        </button>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-muted">
          <time>{new Date(record.event.timestamp).toLocaleTimeString(toLocaleTag(language))}</time>
          {Object.entries(record.deliveries).map(([channel, delivery]) => <span key={channel} title={delivery.error} className={delivery.state === 'failed' ? 'text-status-error' : ''}>
            {channel === 'system' ? t('notifications.system', language) : channel} · {t(deliveryKeys[delivery.state], language)}
          </span>)}
        </div>
      </article>)}
      {(tab === 'local' ? !toasts.length : !visible.length) && <p className="py-12 text-center text-xs text-text-muted">{t('messageCenter.empty', language)}</p>}
    </div>
  </section>
}
