import { create } from 'zustand'
import type { ChatThread } from '../../src/renderer/agent/types'
export { useDisclosureState } from '../../src/renderer/hooks/useDisclosureState'

const threads = Object.fromEntries(['parent', 'tests', 'build'].map((id, index) => [id, {
  id, title: index === 1 ? '检查测试' : '检查构建', parentThreadId: index ? 'parent' : undefined,
  streamState: index ? { phase: 'tool_pending', requestId: `request-${id}`, currentToolCall: {
    id: `tool-${id}`, name: 'run_command', arguments: { command: index === 1 ? 'npm test' : 'npm run build', cwd: 'E:/Project/adnify' }, status: 'awaiting',
  } } : { phase: 'tool_running' },
}])) as Record<string, ChatThread>
export const useAgentStore = create(() => ({ currentThreadId: 'parent', threads, decisions: [] as string[] }))
function decide(decision: string, requestId?: string, toolId?: string) {
  useAgentStore.setState(state => ({ decisions: [...state.decisions, `${decision}:${requestId}:${toolId}`], threads: Object.fromEntries(Object.entries(state.threads).map(([id, thread]) => [id, thread.streamState.requestId === requestId ? { ...thread, streamState: { phase: 'idle' as const } } : thread])) }))
}
export const Agent = { approve: (request?: string, tool?: string) => decide('approve', request, tool), reject: (request?: string, tool?: string) => decide('reject', request, tool) }
export const useStore = create(() => ({ language: 'zh', autoApprove: { terminalCommandRules: [] } }))
export const useMessageQueueStore = create(() => ({ queue: [] }))
export const toast = { success: () => {} }
export const supportsTaskApproval = () => false
