import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { useAgentStore } from '@renderer/agent/store/AgentStore'
import { TURN_ACTIVE_PHASES } from '@renderer/agent/types/thread'
import { ConversationPresentation } from '@renderer/agent/presentation/conversationPresentation'

const PresentationContext = createContext<ConversationPresentation | null>(null)

export function ConversationPresentationProvider({ children }: { children: ReactNode }) {
  const [presentation] = useState(() => new ConversationPresentation({
    now: () => performance.now(),
    schedule: (callback, delayMs) => {
      if (delayMs > 16) {
        const timer = window.setTimeout(callback, delayMs)
        return () => window.clearTimeout(timer)
      }
      // Exactly one winner, including background windows where rAF is throttled.
      const finish = () => { cancelAnimationFrame(frame); clearTimeout(fallback); callback() }
      const frame = requestAnimationFrame(finish)
      const fallback = window.setTimeout(finish, 100)
      return () => { cancelAnimationFrame(frame); clearTimeout(fallback) }
    },
  }))
  useLayoutEffect(() => {
    let previousParts: unknown
    let previousKey = ''
    const refresh = () => {
      const state = useAgentStore.getState()
      const thread = state.currentThreadId ? state.threads[state.currentThreadId] : undefined
      const messageId = thread?.streamState.assistantId
      const message = thread?.liveAssistantMessage
        ?? thread?.messages.find(item => item.id === messageId && item.role === 'assistant')
      const active = !!thread && TURN_ACTIVE_PHASES.has(thread.streamState.phase)
      const parts = message?.role === 'assistant' ? message.parts : undefined
      const key = `${state.currentThreadId}:${message?.id}:${active}`
      if (previousParts === parts && previousKey === key) return
      previousParts = parts
      previousKey = key
      presentation.observe(state.currentThreadId, message?.id, parts ?? [], active)
    }
    const unsubscribe = useAgentStore.subscribe(refresh)
    refresh()
    return () => { unsubscribe(); presentation.dispose() }
  }, [presentation])
  return <PresentationContext.Provider value={presentation}>{children}</PresentationContext.Provider>
}

function usePresentation() {
  const presentation = useContext(PresentationContext)
  if (!presentation) throw new Error('Conversation presentation provider is missing')
  return presentation
}

export function useTurnFrame(messageId: string) {
  return useStore(usePresentation().store, state => state.turns[messageId])
}

export function useDockFrame() {
  return useStore(usePresentation().store, state => state.dock)
}

export function useIsTurnPresenting(messageId: string) {
  return useStore(usePresentation().store, state => {
    const frame = state.turns[messageId]
    return !!frame && frame.phase !== 'complete'
  })
}
