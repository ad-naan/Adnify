import { useEffect } from 'react'
import { useStore } from '@store'
import { api } from '@renderer/services/electronAPI'
import { useToast } from '../common/ToastProvider'
import type { PrivilegeCapability } from '@shared/types/systemPrivilege'

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
  const toast = useToast()

  useEffect(() => api.systemPrivilege.onRequired(({ capability }) => {
    const copy = CAPABILITY_MESSAGE[capability]
    if (!copy) return

    toast.showCard({
      type: 'warning',
      title: language === 'zh' ? '需要管理员权限' : 'Administrator permission required',
      message: copy[language],
      duration: 0,
      source: language === 'zh' ? '系统权限' : 'System privilege',
      dedupeKey: `system-privilege-${capability}`,
      actions: [{
        id: 'restart-elevated',
        label: language === 'zh' ? '以管理员身份重启' : 'Restart as administrator',
        style: 'primary',
        onClick: () => {
          void api.systemPrivilege.requestElevation({ capability, language })
            .then(result => {
              if (!result.success && !result.canceled) {
                toast.error(
                  language === 'zh' ? '无法申请管理员权限' : 'Could not request administrator permission',
                  result.error,
                )
              }
            })
            .catch(error => toast.error(
              language === 'zh' ? '无法申请管理员权限' : 'Could not request administrator permission',
              error instanceof Error ? error.message : String(error),
            ))
        },
      }],
    })
  }), [language, toast])

  return null
}
