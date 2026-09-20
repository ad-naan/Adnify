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

  it('creates a continuity snapshot when first entering L2', async () => {
    const { sourceThreadId } = createIsolatedThreads()
    const sourceStore = useAgentStore.getState().forThread(sourceThreadId)

    await checkAndHandleCompression(
      { input: 750, output: 20 }, 1000, sourceStore, sourceThreadId,
      { workspacePath: '/workspace' } as any, 'assistant-source', true, false,
    )

    const thread = useAgentStore.getState().threads[sourceThreadId]
    expect(thread.compressionStats?.level).toBe(2)
    expect(thread.contextSummary?.objective).toContain('Preserve this task')
  })

  it('refreshes a snapshot after stored history has been trimmed', async () => {
    const { sourceThreadId } = createIsolatedThreads()
    const sourceStore = useAgentStore.getState().forThread(sourceThreadId)
    const now = Date.now()
    sourceStore.setContextSummary({
      objective: 'Original long-running task', completedSteps: [], pendingSteps: [], todos: [],
      decisions: [], keyDecisions: ['Keep the API stable'], fileChanges: [], errorsAndFixes: [],
      userInstructions: ['Preserve the task'], generatedAt: now - 10_000, turnRange: [0, 50],
    })
    useAgentStore.setState(state => ({
      threads: {
        ...state.threads,
        [sourceThreadId]: {
          ...state.threads[sourceThreadId],
          messages: [
            { id: 'new-1', role: 'user', content: 'First new turn', timestamp: now - 2_000 },
            { id: 'new-2', role: 'user', content: 'Second new turn', timestamp: now - 1_000 },
          ] as any,
        },
      },
    }))

    await checkAndHandleCompression(
      { input: 860, output: 20 }, 1000, sourceStore, sourceThreadId,
      { workspacePath: '/workspace' } as any, 'assistant-source', true, false,
    )

    const summary = useAgentStore.getState().threads[sourceThreadId].contextSummary
    expect(summary?.turnRange[1]).toBe(52)
    expect(summary?.objective).toBe('Original long-running task')
    expect(summary?.keyDecisions).toContain('Keep the API stable')
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
