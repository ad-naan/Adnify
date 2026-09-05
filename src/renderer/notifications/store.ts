import { create } from 'zustand'
import type { NotificationSnapshot } from '@shared/types/notifications'

export const useNotifications = create<NotificationSnapshot>(() => ({ revision: -1, records: [] }))
export function acceptNotificationSnapshot(snapshot: NotificationSnapshot): void {
  if (Array.isArray(snapshot?.records) && snapshot.revision >= useNotifications.getState().revision)
    useNotifications.setState(snapshot)
}
