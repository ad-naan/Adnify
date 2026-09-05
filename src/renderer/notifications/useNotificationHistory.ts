import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../services/electronAPI'
import type { NotificationSnapshot } from '@shared/types/notifications'

/** A scoped read model for the message center, independent of notification delivery channels. */
export function useNotificationHistory(scope: string) {
  const [history, setHistory] = useState<NotificationSnapshot & { scope: string }>({ scope, revision: -1, records: [] })
  const [failed, setFailed] = useState(false)
  const refreshRef = useRef<() => void>(() => {})
  const refresh = useCallback(() => refreshRef.current(), [])
  useEffect(() => {
    let disposed = false
    let pending = false
    let again = false
    const load = async () => {
      if (pending) { again = true; return }
      pending = true
      try {
        const snapshot = await api.notifications.history()
        if (!Array.isArray(snapshot?.records) || !Number.isFinite(snapshot.revision)) throw new Error('Invalid notification history')
        if (!disposed) {
          setHistory(previous => previous.scope !== scope || snapshot.revision >= previous.revision ? { ...snapshot, scope } : previous)
          setFailed(false)
        }
      } catch { if (!disposed) setFailed(true) }
      finally {
        pending = false
        if (!disposed && again) { again = false; void load() }
      }
    }
    const request = () => { void load() }
    refreshRef.current = request
    const unsubscribe = api.notifications.onChanged?.(request)
    window.addEventListener('focus', request)
    request()
    return () => { disposed = true; unsubscribe?.(); window.removeEventListener('focus', request) }
  }, [scope])
  return { records: history.scope === scope ? history.records : [], failed, refresh }
}
