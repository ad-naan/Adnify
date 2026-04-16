import { useEffect } from 'react'
import { emotionAdapter } from '@renderer/agent/emotion/emotionAdapter'
import { emotionDetectionEngine } from '@renderer/agent/emotion/emotionDetectionEngine'
import { terminalWatcher } from '@renderer/agent/services/terminalWatcher'
import { adnifyDir } from '@renderer/services/adnifyDirService'
import { terminalManager } from '@renderer/services/TerminalManager'
import { persistAllRuntimeState } from '@renderer/services/appShutdownService'
import { api } from '@renderer/services/electronAPI'
import { logger } from '@utils/Logger'

export function useAppShutdownState(): void {
  useEffect(() => {
    emotionDetectionEngine.start()
    emotionAdapter.initialize()
    terminalWatcher.start()

    const handleUnload = () => {
      try {
        void persistAllRuntimeState()
      } catch {
        /* ignore */
      }

      try {
        terminalManager.cleanup()
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
      terminalWatcher.stop()
      emotionAdapter.cleanup()
      emotionDetectionEngine.stop()
      unsubscribeShutdown()
      window.removeEventListener('beforeunload', handleUnload)
    }
  }, [])
}
