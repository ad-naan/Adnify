import { useEffect } from 'react'
import { useStore } from '@store'
import { api } from '@renderer/services/electronAPI'
import { useToast } from '../common/ToastProvider'
import type { PrivilegeCapability } from '@shared/types/systemPrivilege'
import { getSystemPrivilegeStatus } from '@renderer/services/systemPrivilegeService'

const CAPABILITY_MESSAGE: Record<PrivilegeCapability, { zh: string; en: string }> = {
  'lsp.install': {
    zh: '语言工具安装需要写入受保护的位置。',
    en: 'Language tooling needs to write to a protected location.',
  },
  'file.writeProtected': {
    zh: '当前文件或目录被系统保护，普通模式无法写入。',
    en: 'The current file or directory is system-protected and cannot be written in normal mode.',
  },
  'config.writeProtected': {
    zh: '所选配置目录被系统保护，普通模式无法写入。',
    en: 'The selected configuration directory is system-protected and cannot be written in normal mode.',
  },
}

export default function SystemPrivilegeCoordinator() {
  const language = useStore(state => state.language === 'en' ? 'en' : 'zh')
  const { showCard, error: showError } = useToast()

  useEffect(() => api.systemPrivilege.onRequired(({ capability }) => {
    const copy = CAPABILITY_MESSAGE[capability]
    if (!copy) return

    void getSystemPrivilegeStatus().then(status => {
      const alreadyElevated = status.elevated
      const canElevate = status.canRelaunchElevated
      showCard({
        type: 'warning',
        title: alreadyElevated
          ? (language === 'zh' ? '系统仍拒绝此操作' : 'The system still denied this operation')
          : (language === 'zh' ? '需要管理员权限' : 'Administrator permission required'),
        message: alreadyElevated
          ? (language === 'zh'
              ? '应用已经处于管理员模式；请检查文件所有权、只读属性或是否被其他程序占用。'
              : 'The app is already elevated. Check file ownership, read-only attributes, or whether another program is using it.')
          : canElevate
            ? copy[language]
            : (language === 'zh'
                ? '当前系统不支持自动提权重启，请调整目标目录权限或使用系统提供的方式重新启动应用。'
                : 'Automatic elevation is not available on this system. Adjust the target permissions or restart the app using your system tools.'),
        duration: 0,
        source: language === 'zh' ? '系统权限' : 'System privilege',
        dedupeKey: `system-privilege-${capability}`,
        actions: alreadyElevated || !canElevate ? [] : [{
          id: 'restart-elevated',
          label: language === 'zh' ? '以管理员身份重启' : 'Restart as administrator',
          style: 'primary',
          onClick: () => {
            void api.systemPrivilege.requestElevation({ capability, language })
              .then(result => {
                if (!result.success && !result.canceled) {
                  showError(
                    language === 'zh' ? '无法申请管理员权限' : 'Could not request administrator permission',
                    result.error,
                  )
                }
              })
              .catch(error => showError(
                language === 'zh' ? '无法申请管理员权限' : 'Could not request administrator permission',
                error instanceof Error ? error.message : String(error),
              ))
          },
        }],
      })
    }).catch(() => undefined)
  }), [language, showCard, showError])

  return null
}
