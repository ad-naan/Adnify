import { useEffect } from 'react'
import { emotionAdapter } from '@renderer/agent/emotion/emotionAdapter'
import { emotionDetectionEngine } from '@renderer/agent/emotion/emotionDetectionEngine'
import { flushAgentSessionPersistence, flushStreamingBuffer } from '@renderer/agent/store/AgentStore'
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
      // beforeunload is a last-resort fallback — the primary save path is onShutdownRequested.
      // We perform synchronous staging here so that any in-flight data is at least captured
      // in the shared commit queue. The actual durable flush is performed by
      // the explicit shutdown handshake below.
      try {
        flushStreamingBuffer()
        flushAgentSessionPersistence()
      } catch {
        /* ignore — modules may already be unloaded */
      }

      // Process ownership lives in main. A renderer refresh only detaches the view;
      // actual window closure is observed by the execution service.
    }

    const unsubscribeShutdown = api.app.onShutdownRequested(async ({ requestId }) => {
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
