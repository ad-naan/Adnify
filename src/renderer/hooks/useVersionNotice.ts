/**
 * Hook for detecting version upgrade and prompting changelog / release notes
 */
import { useEffect, useRef } from 'react'
import { api } from '@/renderer/services/electronAPI'
import { useStore } from '@/renderer/store'
import { logger } from '@utils/Logger'

const STORAGE_KEY = 'adnify_last_seen_changelog_version'

export function useVersionNotice(isInitialized: boolean) {
  const setShowChangelog = useStore(s => s.setShowChangelog)
  const checkedRef = useRef(false)

  useEffect(() => {
    if (!isInitialized || checkedRef.current) return
    checkedRef.current = true

    const checkVersion = async () => {
      try {
        const appVersion = await api.getAppVersion()
        if (!appVersion) return

        const lastSeen = localStorage.getItem(STORAGE_KEY)

        if (!lastSeen) {
          // 首次全新安装：记录当前版本，不打扰初始化向导
          localStorage.setItem(STORAGE_KEY, appVersion)
          return
        }

        // 如果版本发生变化（版本升级），自动弹出新版本更新日志
        if (lastSeen !== appVersion) {
          logger.ui.info(`[VersionNotice] Upgraded from ${lastSeen} to ${appVersion}. Prompting changelog.`)
          // 延迟一点时间让界面渲染平稳后弹出
          setTimeout(() => {
            setShowChangelog(true, appVersion)
          }, 800)
          localStorage.setItem(STORAGE_KEY, appVersion)
        }
      } catch (err) {
        logger.ui.error('[VersionNotice] Failed to check app version update:', err)
      }
    }

    void checkVersion()
  }, [isInitialized, setShowChangelog])
}
