import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useStore } from '@store'
import { getSystemPrivilegeStatus } from '@renderer/services/systemPrivilegeService'
import { t } from '@shared/i18n'
import './titlebar-controls.css'

export default function AdministratorModeTitleBadge() {
  const language = useStore(state => state.language)
  const [elevated, setElevated] = useState(false)

  useEffect(() => {
    let mounted = true
    void getSystemPrivilegeStatus()
      .then(status => { if (mounted) setElevated(status.elevated) })
      .catch(() => undefined)
    return () => { mounted = false }
  }, [])

  if (!elevated) return null

  return (
    <div
      className="titlebar-admin"
      title={t('administratorModeTitleBadge.theAppAndLocal', language)}
    >
      <ShieldCheck aria-hidden="true" />
      <span>{t('common.admin', language)}</span>
    </div>
  )
}
