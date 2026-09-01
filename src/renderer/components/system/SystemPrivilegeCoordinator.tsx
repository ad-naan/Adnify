import { useEffect } from 'react'
import { useStore } from '@store'
import { api } from '@renderer/services/electronAPI'
import { useToast } from '../common/ToastProvider'
import type { PrivilegeCapability } from '@shared/types/systemPrivilege'
import { getSystemPrivilegeStatus } from '@renderer/services/systemPrivilegeService'
import { t, type TranslationKey } from '@shared/i18n'

/** 为什么需要权限（提示卡片用）。主进程那份是"系统拒绝了什么"，两者文案不同、都走 locale 表。 */
const CAPABILITY_MESSAGE_KEYS: Record<PrivilegeCapability, TranslationKey> = {
  'lsp.install': 'privilegeCapability.lspInstallRequired',
  'file.writeProtected': 'privilegeCapability.fileWriteProtectedRequired',
  'config.writeProtected': 'privilegeCapability.configWriteProtectedRequired',
}

export default function SystemPrivilegeCoordinator() {
  const language = useStore(state => state.language)
  const { showCard, error: showError } = useToast()

  useEffect(() => api.systemPrivilege.onRequired(({ capability }) => {
    const messageKey = CAPABILITY_MESSAGE_KEYS[capability]
    if (!messageKey) return

    void getSystemPrivilegeStatus().then(status => {
      const alreadyElevated = status.elevated
      const canElevate = status.canRelaunchElevated
      showCard({
        type: 'warning',
        title: alreadyElevated
          ? t('systemPrivilegeCoordinator.theSystemStillDenied', language)
          : t('systemPrivilegeCoordinator.administratorPermissionRequired', language),
        message: alreadyElevated
          ? t('systemPrivilegeCoordinator.theAppIsAlready', language)
          : canElevate
            ? t(messageKey, language)
            : t('systemPrivilegeCoordinator.automaticElevationIsNot', language),
        duration: 0,
        source: t('systemPrivilegeCoordinator.systemPrivilege', language),
        dedupeKey: `system-privilege-${capability}`,
        actions: alreadyElevated || !canElevate ? [] : [{
          id: 'restart-elevated',
          label: t('systemPrivilegeCoordinator.restartAsAdministrator', language),
          style: 'primary',
          onClick: () => {
            void api.systemPrivilege.requestElevation({ capability, language })
              .then(result => {
                if (!result.success && !result.canceled) {
                  showError(
                    t('systemPrivilegeCoordinator.couldNotRequestAdministrator', language),
                    result.error,
                  )
                }
              })
              .catch(error => showError(
                t('systemPrivilegeCoordinator.couldNotRequestAdministrator', language),
                error instanceof Error ? error.message : String(error),
              ))
          },
        }],
      })
    }).catch(() => undefined)
  }), [language, showCard, showError])

  return null
}
