import { useEffect } from 'react'
import { useAgentStore } from '../agent/store/AgentStore'
import { EventBus } from '../agent/core/EventBus'
import { useStore } from '../store'
import { api } from '../services/electronAPI'
import { toast } from '../components/common/ToastProvider'
import { t } from '@shared/i18n'
import { resolveRuntimeLLMConfig } from '@shared/config/llmConfigResolver'
import { projectBackgroundActivity } from './activity'
import { useBackgroundConnections } from './connections'

export function useBackgroundTasks(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let failureTimer: ReturnType<typeof setTimeout> | undefined
    let recentFailure = false
    let lastActivity = ''
    let receivedConnections = false

    const publish = (force = false) => {
      clearTimeout(timer)
      timer = undefined
      if (disposed) return
      const { threads, plans } = useAgentStore.getState()
      const { llmConfig, providerConfigs } = useStore.getState()
      const modelConfig = resolveRuntimeLLMConfig(llmConfig, providerConfigs)
      const activity = {
        ...projectBackgroundActivity(threads, plans, recentFailure),
        model: { provider: modelConfig.provider, baseUrl: modelConfig.baseUrl },
      }
      const signature = JSON.stringify(activity)
      if (!force && signature === lastActivity) return
      lastActivity = signature
      void api.backgroundTasks.update(activity).catch(() => { lastActivity = '' })
    }
    // Token streaming can write hundreds of times per second. Project once per batch.
    const schedule = () => { timer ??= setTimeout(() => publish(), 250) }
    const subscriptions = [
      useAgentStore.subscribe(schedule),
      useStore.subscribe((state, previous) => {
        if (state.llmConfig !== previous.llmConfig || state.providerConfigs !== previous.providerConfigs) schedule()
      }),
      EventBus.onAll(event => {
        if (event.type === 'loop:start' || event.type === 'plan:start' || event.type === 'plan:resumed') {
          recentFailure = false
          clearTimeout(failureTimer)
          schedule()
        }
        if ((event.type === 'loop:end' && event.reason === 'error') || event.type === 'plan:failed') {
          recentFailure = true
          clearTimeout(failureTimer)
          failureTimer = setTimeout(() => { recentFailure = false; publish() }, 15_000)
          schedule()
        }
      }),
      api.backgroundTasks.onResume(() => publish(true)),
      api.backgroundTasks.onConnections(state => {
        receivedConnections = true
        useBackgroundConnections.setState(state)
        const report = state.report
        if (!state.checking && report && (report.checkFailed || report.model === 'unreachable' || report.mcp.failed.length)) {
          toast.warning(t('backgroundTasks.recoveryNeeded', useStore.getState().language))
        }
      }),
    ]
    void api.backgroundTasks.getConnections().then(state => {
      if (!disposed && !receivedConnections && typeof state.checking === 'boolean') useBackgroundConnections.setState(state)
    }).catch(() => {})
    const heartbeat = setInterval(() => publish(true), 20_000)
    publish(true)
    return () => {
      disposed = true
      clearTimeout(timer)
      clearTimeout(failureTimer)
      clearInterval(heartbeat)
      subscriptions.forEach(unsubscribe => unsubscribe())
      void api.backgroundTasks.update({ state: 'idle' }).catch(() => {})
    }
  }, [enabled])
}
