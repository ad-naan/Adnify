// Isolate ChatPanel from Electron, model calls and unrelated UI. The panel,
// Virtuoso, scroll controller and focus/animation hook all run unchanged.
import { create } from 'zustand'
import type { ComponentPropsWithoutRef, RefObject } from 'react'
import type { ChatMessage as Message } from '../../src/renderer/agent/types'
export { useChatScrollController } from '../../src/renderer/hooks/useChatScrollController'

const noop = () => {}
const empty: never[] = []
const thread = { id: 'focus', mode: 'agent', origin: 'user', messagesHydrated: true, streamState: { phase: 'idle' }, handoff: { status: 'idle' } }
export const useAgentStore = create(() => ({
  currentThreadId: 'focus', threads: { focus: thread }, inputPrompt: '', setInputPrompt: noop,
}))
export const selectTodos = () => empty
export const useStore = create(() => ({
  language: 'en', llmConfig: { provider: 'openai', apiKey: 'fixture' },
  workspacePath: null, activeFilePath: null, selectedCode: null, openFile: noop, setActiveFile: noop,
}))
export const useModeStore = create(() => ({ currentMode: 'agent', setMode: noop }))
export const useAgentViewState = create(() => ({
  messages: Array.from({ length: 30 }, (_, index) => ({
    id: `message-${index}`, role: 'user', content: `Message ${index}`, timestamp: index,
  })) as Message[],
  currentThreadId: 'focus', messageListVersion: 0, isStreaming: false,
  isAwaitingApproval: false, pendingToolCall: undefined, pendingToolCalls: empty,
  pendingChanges: empty, messageCheckpoints: empty, contextItems: empty, laneNotice: undefined,
}))
const actions = new Proxy({}, { get: () => noop })
export const useAgentActions = () => actions
export const useAgentCommands = () => actions
export const useMessageQueueConsumer = noop
export const useMessageQueueStore = create(() => ({ queue: empty }))
export const useToast = () => actions

export const loadEmotionPanelSettings = () => ({ decorativeAnimations: true })
export const subscribeEmotionPanelSettings = () => noop
export const api = {}
export const logger = {}
export const MentionParser = {}
export const keybindingService = {}
export const slashCommandService = {}
export const composerService = {}
export const shellServerRoutingService = {}
export const globalConfirm = noop
export const supportsTaskApproval = () => false
export const BranchSelector = () => null
export const ChatMessagesSkeleton = () => null
export function Button({ variant: _variant, size: _size, ...props }: ComponentPropsWithoutRef<'button'> & { variant?: string; size?: string }) {
  return <button {...props} />
}
export function ChatInput({ textareaRef }: { textareaRef: RefObject<HTMLTextAreaElement> }) {
  return <textarea ref={textareaRef} aria-label="Message input" style={{ height: 70 }} />
}
export default function Stub({ message }: { message?: Message }) {
  const contentLength = message && 'content' in message && typeof message.content === 'string' ? message.content.length : 0
  return message ? <div data-message={message.id} style={{ height: 120 + contentLength, padding: 16 }}>{message.id}</div> : null
}
