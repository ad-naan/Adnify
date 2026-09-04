import { create } from 'zustand'
import type { AssistantPart } from '../../src/renderer/agent/types'

export const useAgentStore = create(() => ({
  currentThreadId: 'fixture',
  threads: {
    fixture: {
      streamState: { assistantId: 'reply', phase: 'idle' },
      liveAssistantMessage: undefined as { id: string; role: string; parts: AssistantPart[] } | undefined,
      messages: [] as { id: string; role: string; parts: AssistantPart[] }[],
    },
  },
}))

export function publish(parts: AssistantPart[], active: boolean) {
  const message = { id: 'reply', role: 'assistant', parts }
  useAgentStore.setState({ threads: { fixture: {
    streamState: { assistantId: 'reply', phase: active ? 'tool_pending' : 'idle' },
    liveAssistantMessage: active ? message : undefined,
    messages: [message],
  } } })
}
