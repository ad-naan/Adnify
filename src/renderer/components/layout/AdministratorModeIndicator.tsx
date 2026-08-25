import { useEffect, useState } from 'react'
import { RotateCcw, ShieldCheck } from 'lucide-react'
import { useStore } from '@store'
import { api } from '@renderer/services/electronAPI'
import { toast } from '../common/ToastProvider'
import BottomBarPopover from '../ui/BottomBarPopover'
import type { SystemPrivilegeStatus } from '@shared/types/systemPrivilege'
import { getSystemPrivilegeStatus } from '@renderer/services/systemPrivilegeService'

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
        language === 'zh' ? '无法恢复普通模式' : 'Could not return to normal mode',
        result.error,
      )
    } catch (error) {
      setRestarting(false)
      toast.error(
        language === 'zh' ? '无法恢复普通模式' : 'Could not return to normal mode',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  return (
    <BottomBarPopover
      width={320}
      title={language === 'zh' ? '管理员模式' : 'Administrator mode'}
      tooltip={language === 'zh' ? '应用正以管理员权限运行' : 'The app is running as administrator'}
      icon={
        <span className="flex items-center gap-1.5 px-1 text-amber-400">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span className="text-[9px] font-semibold">{language === 'zh' ? '管理员' : 'Admin'}</span>
        </span>
      }
    >
      <div className="space-y-3 p-4">
        <p className="text-[11px] leading-5 text-text-secondary">
          {language === 'zh'
            ? '当前应用及其启动的本地工具都拥有管理员权限。完成受保护操作后，建议恢复普通模式。'
            : 'The app and local tools it launches currently have administrator privileges. Return to normal mode after protected work is complete.'}
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
              ? (language === 'zh' ? '正在重启…' : 'Restarting…')
              : (language === 'zh' ? '以普通权限重启' : 'Restart in normal mode')}
          </button>
        ) : (
          <p className="rounded-md border border-border/50 bg-background/40 px-3 py-2 text-[10px] leading-4 text-text-muted">
            {language === 'zh'
              ? '当前系统不支持自动恢复普通权限，请退出后使用普通用户账户重新启动。'
              : 'Automatic de-elevation is unavailable on this system. Quit and restart using a normal user account.'}
          </p>
        )}
      </div>
    </BottomBarPopover>
  )
}
