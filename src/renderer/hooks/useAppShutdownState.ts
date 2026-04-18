import { useEffect } from 'react'
import { emotionAdapter } from '@renderer/agent/emotion/emotionAdapter'
import { emotionDetectionEngine } from '@renderer/agent/emotion/emotionDetectionEngine'
import { adnifyDir } from '@renderer/services/adnifyDirService'
import { persistAllRuntimeState } from '@renderer/services/appShutdownService'
import { api } from '@renderer/services/electronAPI'
import { logger } from '@utils/Logger'

export function useAppShutdownState(): void {
  useEffect(() => {
    let terminalWatcherCleanup: (() => void) | null = null

    emotionDetectionEngine.start()
    emotionAdapter.initialize()
    void import('@renderer/agent/services/terminalWatcher')
      .then(({ terminalWatcher }) => {
        terminalWatcher.start()
        terminalWatcherCleanup = () => terminalWatcher.stop()
      })
      .catch((error) => {
        logger.system.warn('[App] Failed to initialize terminal watcher:', error)
      })

    const handleUnload = () => {
      try {
        void persistAllRuntimeState()
      } catch {
        /* ignore */
      }

      try {
        void import('@renderer/services/TerminalManager')
          .then(({ terminalManager }) => terminalManager.cleanup())
          .catch(() => {
            /* ignore */
          })
      } catch {
        /* ignore */
      }

      try {
        void adnifyDir.flush()
      } catch {
        /* ignore */
      }
    }

    const unsubscribeShutdown = api.app.onShutdownRequested(async ({ requestId, reason }) => {
      let success = true
      try {
        await persistAllRuntimeState()
      } catch (error) {
        success = false
        logger.system.error('[App] Failed to persist runtime state during shutdown:', error)
      }

      try {
        await api.app.respondToShutdownRequest(requestId, success)
      } catch {
        /* ignore */
      }
    })

    window.addEventListener('beforeunload', handleUnload)

    return () => {
      terminalWatcherCleanup?.()
      emotionAdapter.cleanup()
      emotionDetectionEngine.stop()
      unsubscribeShutdown()
      window.removeEventListener('beforeunload', handleUnload)
    }
  }, [])
}
