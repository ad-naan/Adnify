import { useEffect } from 'react'
import { useStore } from '@store'
import { api } from '@renderer/services/electronAPI'
import { useToast } from '../common/ToastProvider'
import type { PrivilegeCapability } from '@shared/types/systemPrivilege'
import { getSystemPrivilegeStatus } from '@renderer/services/systemPrivilegeService'
import { t, asLanguage } from '@renderer/i18n'

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
          ? (t('systemPrivilegeCoordinator.theSystemStillDenied', asLanguage(language)))
          : (t('systemPrivilegeCoordinator.administratorPermissionRequired', asLanguage(language))),
        message: alreadyElevated
          ? (t('systemPrivilegeCoordinator.theAppIsAlready', asLanguage(language)))
          : canElevate
            ? copy[language]
            : (t('systemPrivilegeCoordinator.automaticElevationIsNot', asLanguage(language))),
        duration: 0,
        source: t('systemPrivilegeCoordinator.systemPrivilege', asLanguage(language)),
        dedupeKey: `system-privilege-${capability}`,
        actions: alreadyElevated || !canElevate ? [] : [{
          id: 'restart-elevated',
          label: t('systemPrivilegeCoordinator.restartAsAdministrator', asLanguage(language)),
          style: 'primary',
          onClick: () => {
            void api.systemPrivilege.requestElevation({ capability, language })
              .then(result => {
                if (!result.success && !result.canceled) {
                  showError(
                    t('systemPrivilegeCoordinator.couldNotRequestAdministrator', asLanguage(language)),
                    result.error,
                  )
                }
              })
              .catch(error => showError(
                t('systemPrivilegeCoordinator.couldNotRequestAdministrator', asLanguage(language)),
                error instanceof Error ? error.message : String(error),
              ))
          },
        }],
      })
    }).catch(() => undefined)
  }), [language, showCard, showError])

  return null
}
