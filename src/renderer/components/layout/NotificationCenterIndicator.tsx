import { Bell } from 'lucide-react'
import { t, type Language } from '@shared/i18n'
import BottomBarPopover from '../ui/BottomBarPopover'
import NotificationCenterContent from '../panels/NotificationCenterContent'
import { useNotificationHistory } from '../../notifications/useNotificationHistory'

export default function NotificationCenterIndicator({ language, scope }: { language: Language; scope: string }) {
  const { records, failed, refresh } = useNotificationHistory(scope)
  const unread = records.filter(record => !record.read).length
  const title = t('messageCenter.title', language)
  return <BottomBarPopover tooltip={title} width={380} height={440} scrollable={false}
    onOpenChange={open => { if (open) refresh() }}
    icon={<span className="group relative flex h-6 w-6 items-center justify-center" aria-label={t('messageCenter.unreadCount', language, { count: unread })}>
      <Bell className={`h-3.5 w-3.5 ${unread ? 'text-blue-400' : 'text-text-muted group-hover:text-text-primary'}`} />
      {unread > 0 && <span className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-blue-400" />}
    </span>}>
    <NotificationCenterContent language={language} records={records} failed={failed} refresh={refresh} />
  </BottomBarPopover>
}
