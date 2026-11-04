import { beforeEach, describe, expect, it, vi } from 'vitest'
import { countTokens, ensureTokenEncoder, recordObservedTokenUsage, resetObservedTokenUsage } from '@shared/utils/tokenCounter'
import type { ChatMessage } from '@renderer/agent/types'

const mocks = vi.hoisted(() => ({ buildContextContent: vi.fn() }))
vi.mock('@renderer/agent/llm/ContextBuilder', () => ({ buildContextContent: mocks.buildContextContent }))
vi.mock('@renderer/agent/store/AgentStore', () => ({ useAgentStore: { getState: () => ({ threads: {} }) } }))

import { AgentExecutor } from '@renderer/agent/application/AgentExecutor'
import { estimateMessagesTokens } from '@renderer/agent/domains/context/CompressionManager'

describe('request-scoped token estimates', () => {
  const text = 'A shared piece of history and referenced context. '.repeat(30)
  const history = [{ id: 'previous', role: 'assistant', content: text, timestamp: 1 }] as ChatMessage[]

  beforeEach(async () => {
    await ensureTokenEncoder()
    resetObservedTokenUsage()
    mocks.buildContextContent.mockReset().mockResolvedValue(text)
    for (let i = 0; i < 10; i++) {
      recordObservedTokenUsage('model-b', countTokens(text, 'model-b'), countTokens(text) * 2)
    }
  })

  it('keeps each model estimate when asynchronous preparations complete in reverse order', async () => {
    const executor = new AgentExecutor()
    const prepare = (model: string) => executor.prepare(text, [], history, text, {
      model, mode: 'plan', workspacePath: null,
      planContext: { requirementsContent: text, taskObjective: 'Verify the implementation' },
    })
    const expectedA = await prepare('model-a')
    const expectedB = await prepare('model-b')
    expect(expectedB.estimatedTokens).toBeGreaterThan(expectedA.estimatedTokens)

    let finishA!: (value: string) => void
    mocks.buildContextContent.mockImplementationOnce(() => new Promise<string>(resolve => { finishA = resolve }))
    const a = prepare('model-a')
    await vi.waitFor(() => expect(finishA).toBeTypeOf('function'))
    const b = await prepare('model-b')
    finishA(text)
    expect((await a).estimatedTokens).toBe(expectedA.estimatedTokens)
    expect(b.estimatedTokens).toBe(expectedB.estimatedTokens)
  })

  it('invalidates cached message estimates when the model or its calibration changes', () => {
    const raw = estimateMessagesTokens(history)
    expect(estimateMessagesTokens(history, 'model-b')).toBeGreaterThan(raw)
    expect(estimateMessagesTokens(history, 'model-a')).toBe(raw)
    recordObservedTokenUsage('model-a', raw, raw * 2)
    expect(estimateMessagesTokens(history, 'model-a')).toBeGreaterThan(raw)
    expect(estimateMessagesTokens(history)).toBe(raw)
  })
})
