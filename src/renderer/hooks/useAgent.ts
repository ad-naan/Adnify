/**
 * Focused Agent hooks.
 *
 * Keep view subscriptions, command wiring, and maintenance actions separate so
 * renderer components only subscribe to the state they actually render.
 */

import { api } from '@/renderer/services/electronAPI'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useModeStore } from '@/renderer/store'
import { useShallow } from 'zustand/react/shallow'
import {
  useAgentStore,
  selectMessageListState,
  selectStreamState,
  selectContextItems,
  selectIsStreaming,
  selectIsAwaitingApproval,
  selectPendingChanges,
  selectMessageCheckpoints,
} from '@/renderer/agent/store/AgentStore'
import { Agent } from '@/renderer/agent/core'
import { getAgentConfig } from '@/renderer/agent/utils/AgentConfig'
import { MessageContent, ChatThread, ToolCall } from '@/renderer/agent/types'

let cachedThreadsRef: Record<string, ChatThread> | null = null
let cachedSortedThreads: ChatThread[] = []

export function useAllThreads(): ChatThread[] {
  return useAgentStore(state => {
    if (state.threads === cachedThreadsRef) {
      return cachedSortedThreads
    }

    cachedThreadsRef = state.threads
    cachedSortedThreads = Object.values(state.threads).sort((a, b) => b.lastModified - a.lastModified)
    return cachedSortedThreads
  })
}

const getAgentActions = () => useAgentStore.getState()

function clearAgentConversationState(): void {
  getAgentActions().clearMessages()
  useStore.getState().clearToolCallLogs()
  getAgentActions().setHandoffRequired(false)
  getAgentActions().setHandoffDocument(null)
  getAgentActions().setCompressionStats(null)
}

export function useAgentCommands() {
  const llmConfig = useStore(state => state.llmConfig)
  const workspacePath = useStore(state => state.workspacePath)
  const promptTemplateId = useStore(state => state.promptTemplateId)
  const openFiles = useStore(state => state.openFiles)
  const activeFilePath = useStore(state => state.activeFilePath)
  const chatMode = useModeStore(state => state.currentMode)

  const [aiInstructions, setAiInstructions] = useState('')

  useEffect(() => {
    api.settings.get('app-settings').then((settings: any) => {
      if (settings?.aiInstructions) {
        setAiInstructions(settings.aiInstructions)
      }
    })
  }, [])

  const planPhase = useAgentStore<'planning' | 'executing'>(state => {
    const activePlan = state.plans.find(plan => plan.id === state.activePlanId)
    return activePlan?.status === 'executing' ? 'executing' : 'planning'
  })
  const streamState = useAgentStore(selectStreamState)

  const sendParamsRef = useRef({
    llmConfig,
    workspacePath,
    chatMode,
    promptTemplateId,
    aiInstructions,
    openFiles,
    activeFilePath,
    planPhase,
  })

  sendParamsRef.current = {
    llmConfig,
    workspacePath,
    chatMode,
    promptTemplateId,
    aiInstructions,
    openFiles,
    activeFilePath,
    planPhase,
  }

  const sendMessage = useCallback(async (content: MessageContent) => {
    const {
      llmConfig: config,
      workspacePath: currentWorkspacePath,
      chatMode: currentChatMode,
      promptTemplateId: currentPromptTemplateId,
      aiInstructions: currentAiInstructions,
      openFiles: currentOpenFiles,
      activeFilePath: currentActiveFilePath,
      planPhase: currentPlanPhase,
    } = sendParamsRef.current

    const agentConfig = getAgentConfig()

    await Agent.send(
      content,
      {
        provider: config.provider,
        model: config.model,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        timeout: config.timeout,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        topP: config.topP,
        enableThinking: config.enableThinking,
        thinkingBudget: config.thinkingBudget,
        reasoningEffort: config.reasoningEffort,
        protocol: config.protocol,
        headers: config.headers,
        contextLimit: agentConfig.maxContextTokens,
      },
      currentWorkspacePath,
      currentChatMode,
      {
        openFiles: currentOpenFiles.map(file => file.path),
        activeFile: currentActiveFilePath || undefined,
        customInstructions: currentAiInstructions,
        promptTemplateId: currentPromptTemplateId,
        planPhase: currentChatMode === 'plan' ? currentPlanPhase : undefined,
      }
    )
  }, [])

  const abort = useCallback(() => {
    Agent.abort()
  }, [])

  const pendingApprovalRequestId = useMemo(() => {
    if (streamState.phase !== 'tool_pending') {
      return undefined
    }

    return streamState.requestId
  }, [streamState.phase, streamState.requestId])

  const approveCurrentTool = useCallback(() => {
    Agent.approve(pendingApprovalRequestId)
  }, [pendingApprovalRequestId])

  const rejectCurrentTool = useCallback(() => {
    Agent.reject(pendingApprovalRequestId)
  }, [pendingApprovalRequestId])

  return {
    sendMessage,
    abort,
    approveCurrentTool,
    rejectCurrentTool,
  }
}

export function useAgentActions() {
  return useMemo(() => ({
    createThread: getAgentActions().createThread,
    switchThread: getAgentActions().switchThread,
    deleteThread: getAgentActions().deleteThread,
    deleteMessagesAfter: getAgentActions().deleteMessagesAfter,
    acceptAllChanges: getAgentActions().acceptAllChanges,
    undoAllChanges: getAgentActions().undoAllChanges,
    acceptChange: getAgentActions().acceptChange,
    undoChange: getAgentActions().undoChange,
    restoreToCheckpoint: getAgentActions().restoreToCheckpoint,
    getCheckpointForMessage: getAgentActions().getCheckpointForMessage,
    addContextItem: getAgentActions().addContextItem,
    removeContextItem: getAgentActions().removeContextItem,
    clearContextItems: getAgentActions().clearContextItems,
    createBranch: getAgentActions().createBranch,
    switchBranch: getAgentActions().switchBranch,
    regenerateFromMessage: getAgentActions().regenerateFromMessage,
    clearMessages: clearAgentConversationState,
  }), [])
}

export function useAgentHistoryActions() {
  return useMemo(() => ({
    clearMessages: clearAgentConversationState,
    clearCheckpoints: getAgentActions().clearMessageCheckpoints,
  }), [])
}

export function useAgentChangeState() {
  const pendingChanges = useAgentStore(selectPendingChanges)

  return useMemo(() => ({
    pendingChanges,
    acceptChange: getAgentActions().acceptChange,
    undoChange: getAgentActions().undoChange,
  }), [pendingChanges])
}

export function useAgentViewState() {
  const {
    messages,
    streamState,
    contextItems,
    isStreaming,
    isAwaitingApproval,
    pendingChanges,
    messageCheckpoints,
    currentThreadId,
  } = useAgentStore(useShallow(state => ({
    messages: selectMessageListState(state).messages,
    streamState: selectStreamState(state),
    contextItems: selectContextItems(state),
    isStreaming: selectIsStreaming(state),
    isAwaitingApproval: selectIsAwaitingApproval(state),
    pendingChanges: selectPendingChanges(state),
    messageCheckpoints: selectMessageCheckpoints(state),
    currentThreadId: state.currentThreadId,
  })))

  const pendingToolCall = useMemo((): ToolCall | undefined => {
    if (streamState.phase === 'tool_pending' && streamState.currentToolCall) {
      return streamState.currentToolCall
    }

    return undefined
  }, [streamState])

  return {
    messages,
    streamState,
    contextItems,
    isStreaming,
    isAwaitingApproval,
    pendingToolCall,
    pendingChanges,
    messageCheckpoints,
    currentThreadId,
  }
}

export function useAgent() {
  const viewState = useAgentViewState()
  const commands = useAgentCommands()
  const actions = useAgentActions()
  const historyActions = useAgentHistoryActions()

  return {
    ...viewState,
    ...commands,
    ...actions,
    ...historyActions,
  }
}
