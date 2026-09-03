import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '@store'
import { api } from '@renderer/services/electronAPI'
import { checkAndHandleCompression } from '@renderer/agent/core/contextCompression'
import { prepareHandoffForThread } from '@renderer/agent/services/handoffSessionService'
import { useAgentStore } from '@renderer/agent/store/AgentStore'

describe('context compression lifecycle', () => {
  beforeEach(() => {
    useAgentStore.setState({
      threads: {},
      currentThreadId: null,
      contextTransition: { status: 'idle' },
    })
    useStore.setState({
      workspacePath: '/workspace',
      llmConfig: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: '',
        baseUrl: '',
        timeout: 30_000,
      },
    } as any)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function createIsolatedThreads() {
    const state = useAgentStore.getState()
    const sourceThreadId = state.createThread({ activate: false })
    const activeThreadId = state.createThread({ activate: true })
    state.addUserMessage('Preserve this task across compression.', [], sourceThreadId)
    return { sourceThreadId, activeThreadId }
  }

  it('refreshes working-memory health on the source thread only', async () => {
    const { sourceThreadId, activeThreadId } = createIsolatedThreads()
    const sourceStore = useAgentStore.getState().forThread(sourceThreadId)

    await checkAndHandleCompression(
      { input: 860, output: 20 },
      1000,
      sourceStore,
      sourceThreadId,
      { workspacePath: '/workspace' } as any,
      'assistant-source',
      true,
      false,
    )

    const state = useAgentStore.getState()
    expect(state.currentThreadId).toBe(activeThreadId)
    expect(state.threads[sourceThreadId].contextSummary).not.toBeNull()
    expect(state.threads[sourceThreadId].compressionStats?.memoryHealth.score).toBeGreaterThan(0)
    expect(state.threads[sourceThreadId].compressionPhase).toBe('idle')
    expect(state.threads[activeThreadId].contextSummary).toBeNull()
    expect(state.threads[activeThreadId].compressionStats).toBeNull()
  })

  it('clears only the source thread compression phase after a timed-out handoff', async () => {
    vi.useFakeTimers()
    const { sourceThreadId, activeThreadId } = createIsolatedThreads()
    useStore.setState({
      llmConfig: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'test-key',
        baseUrl: '',
        timeout: 25,
      },
    } as any)
    vi.spyOn(api.llm, 'generateObject').mockReturnValue(new Promise(() => {}))

    const handoffPromise = prepareHandoffForThread(sourceThreadId)
    expect(useAgentStore.getState().threads[sourceThreadId].compressionPhase).toBe('summarizing')
    expect(useAgentStore.getState().threads[activeThreadId].compressionPhase).toBe('idle')

    await vi.advanceTimersByTimeAsync(25)
    const result = await handoffPromise

    const state = useAgentStore.getState()
    expect(result.source).toBe('rule_based')
    expect(state.currentThreadId).toBe(activeThreadId)
    expect(state.threads[sourceThreadId].compressionPhase).toBe('idle')
    expect(state.threads[sourceThreadId].handoff.status).toBe('ready')
    expect(state.threads[activeThreadId].compressionPhase).toBe('idle')
    expect(state.threads[activeThreadId].handoff.status).toBe('idle')
    expect(state.contextTransition.status).toBe('idle')
  })
})
