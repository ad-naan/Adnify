import { useEffect, useState } from 'react'
import { RotateCcw, ShieldCheck } from 'lucide-react'
import { useStore } from '@store'
import { api } from '@renderer/services/electronAPI'
import { toast } from '../common/ToastProvider'
import BottomBarPopover from '../ui/BottomBarPopover'
import type { SystemPrivilegeStatus } from '@shared/types/systemPrivilege'
import { getSystemPrivilegeStatus } from '@renderer/services/systemPrivilegeService'
import { t, asLanguage } from '@renderer/i18n'

export default function AdministratorModeIndicator() {
  const language = useStore(state => state.language)
  const [status, setStatus] = useState<SystemPrivilegeStatus | null>(null)
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    let mounted = true
    void getSystemPrivilegeStatus().then(status => {
      if (mounted) setStatus(status)
    }).catch(() => undefined)
    return () => { mounted = false }
  }, [])

  if (!status?.elevated) return null

  const restartNormally = async () => {
    setRestarting(true)
    try {
      const result = await api.systemPrivilege.restartNormally()
      if (result.success) return
      setRestarting(false)
      toast.error(
        t('administratorModeIndicator.couldNotReturnTo', asLanguage(language)),
        result.error,
      )
    } catch (error) {
      setRestarting(false)
      toast.error(
        t('administratorModeIndicator.couldNotReturnTo', asLanguage(language)),
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  return (
    <BottomBarPopover
      width={320}
      title={t('administratorModeIndicator.administratorMode', asLanguage(language))}
      tooltip={t('administratorModeIndicator.theAppIsRunning', asLanguage(language))}
      icon={
        <span className="flex items-center gap-1.5 px-1 text-amber-400">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span className="text-[9px] font-semibold">{t('common.admin', asLanguage(language))}</span>
        </span>
      }
    >
      <div className="space-y-3 p-4">
        <p className="text-[11px] leading-5 text-text-secondary">
          {t('administratorModeIndicator.theAppAndLocal', asLanguage(language))}
        </p>
        {status.platform === 'win32' ? (
          <button
            type="button"
            disabled={restarting}
            onClick={() => void restartNormally()}
            className="flex h-8 w-full items-center justify-center gap-2 rounded-md border border-amber-400/25 bg-amber-400/10 text-[11px] font-medium text-amber-300 transition-colors hover:bg-amber-400/15 disabled:cursor-wait disabled:opacity-60"
          >
            <RotateCcw className={`h-3.5 w-3.5 ${restarting ? 'animate-spin' : ''}`} />
            {restarting
              ? (t('administratorModeIndicator.restarting', asLanguage(language)))
              : (t('administratorModeIndicator.restartInNormalMode', asLanguage(language)))}
          </button>
        ) : (
          <p className="rounded-md border border-border/50 bg-background/40 px-3 py-2 text-[10px] leading-4 text-text-muted">
            {t('administratorModeIndicator.automaticDeElevationIs', asLanguage(language))}
          </p>
        )}
      </div>
    </BottomBarPopover>
  )
}
