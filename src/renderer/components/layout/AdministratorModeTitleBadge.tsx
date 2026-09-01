import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useStore } from '@store'
import { getSystemPrivilegeStatus } from '@renderer/services/systemPrivilegeService'
import { t } from '@shared/i18n'

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
      className="flex h-7 items-center gap-1.5 rounded-md border border-amber-400/20 bg-amber-400/10 px-2 text-[10px] font-semibold text-amber-300"
      title={t('administratorModeTitleBadge.theAppAndLocal', language)}
    >
      <ShieldCheck className="h-3.5 w-3.5" />
      <span>{t('common.admin', language)}</span>
    </div>
  )
}
