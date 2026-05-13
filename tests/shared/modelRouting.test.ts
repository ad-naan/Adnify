import { describe, expect, it } from 'vitest'
import {
  resolveRuntimeModelRoutingConfig,
  resolveMessageRouting,
} from '@shared/config/modelRouting'
import { injectVisualSummaryIntoMessages, stripImagesFromLatestUserMessage } from '@renderer/agent/services/multimodalRoutingService'
import type { LLMConfig, LLMMessage } from '@shared/types/llm'

function createConfig(overrides: Partial<LLMConfig> = {}): LLMConfig {
  return {
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: 'test-key',
    timeout: 120000,
    temperature: 0.7,
    topP: 1,
    maxTokens: 4096,
    ...overrides,
  }
}

describe('model routing', () => {
  it('uses the active llm config as the primary route by default', () => {
    const config = createConfig({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' })

    expect(resolveRuntimeModelRoutingConfig(undefined, config)).toEqual({
      enabled: false,
      primary: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      },
      multimodal: undefined,
      fallbackPolicy: 'primary_with_notice',
      handoffFormat: 'structured_summary_with_raw_block',
    })
  })

  it('skips multimodal prepass when routing is not enabled', () => {
    const config = createConfig()
    const routingConfig = resolveRuntimeModelRoutingConfig({
      enabled: false,
      multimodal: { provider: 'gemini', model: 'gemini-2.0-flash-exp' },
    }, config)
    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe this' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
        ],
      },
    ]

    const result = resolveMessageRouting(messages, routingConfig, {
      gemini: { apiKey: 'gemini-key', model: 'gemini-2.0-flash-exp' },
    }, config)

    expect(result.shouldUseMultimodalPrepass).toBe(false)
    expect(result.reason).toBe('no-config')
  })

  it('keeps the old path when the latest user message has no image', () => {
    const config = createConfig()
    const routingConfig = resolveRuntimeModelRoutingConfig({ enabled: true }, config)
    const messages: LLMMessage[] = [
      { role: 'user', content: 'plain text request' },
    ]

    const result = resolveMessageRouting(messages, routingConfig, {}, config)

    expect(result.shouldUseMultimodalPrepass).toBe(false)
    expect(result.reason).toBe('no-image')
    expect(result.multimodalConfig).toBeUndefined()
  })

  it('keeps the old path when images exist but no multimodal model is configured', () => {
    const config = createConfig()
    const routingConfig = resolveRuntimeModelRoutingConfig({ enabled: true }, config)
    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe this image' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
        ],
      },
    ]

    const result = resolveMessageRouting(messages, routingConfig, {}, config)

    expect(result.shouldUseMultimodalPrepass).toBe(false)
    expect(result.reason).toBe('no-config')
    expect(result.multimodalConfig).toBeUndefined()
  })

  it('enables multimodal prepass when an image is present and the multimodal route resolves', () => {
    const config = createConfig()
    const routingConfig = resolveRuntimeModelRoutingConfig({
      enabled: true,
      multimodal: {
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp',
      },
    }, config)
    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'extract text from this screenshot' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
        ],
      },
    ]

    const result = resolveMessageRouting(messages, routingConfig, {
      gemini: {
        apiKey: 'gemini-key',
        model: 'gemini-2.0-flash-exp',
      },
    }, config)

    expect(result.shouldUseMultimodalPrepass).toBe(true)
    expect(result.reason).toBe('configured')
    expect(result.multimodalConfig).toMatchObject({
      provider: 'gemini',
      model: 'gemini-2.0-flash-exp',
      apiKey: 'gemini-key',
    })
  })

  it('does not retrigger multimodal prepass for historical image messages', () => {
    const config = createConfig()
    const routingConfig = resolveRuntimeModelRoutingConfig({
      enabled: true,
      multimodal: {
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp',
      },
    }, config)
    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'first image' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
        ],
      },
      { role: 'assistant', content: 'what should I do next?' },
      { role: 'user', content: 'now summarize it in one sentence' },
    ]

    const result = resolveMessageRouting(messages, routingConfig, {
      gemini: {
        apiKey: 'gemini-key',
        model: 'gemini-2.0-flash-exp',
      },
    }, config)

    expect(result.shouldUseMultimodalPrepass).toBe(false)
    expect(result.reason).toBe('no-image')
  })

  it('skips prepass when multimodal route points to the same model as primary', () => {
    const config = createConfig({ provider: 'openai', model: 'gpt-4o' })
    const routingConfig = resolveRuntimeModelRoutingConfig({
      enabled: true,
      multimodal: {
        provider: 'openai',
        model: 'gpt-4o',
      },
    }, config)
    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
        ],
      },
    ]

    const result = resolveMessageRouting(messages, routingConfig, {
      openai: { apiKey: 'openai-key', model: 'gpt-4o' },
    }, config)

    expect(result.shouldUseMultimodalPrepass).toBe(false)
    expect(result.reason).toBe('same-model')
  })

  it('injects the visual analysis summary into the latest user message only', () => {
    const messages: LLMMessage[] = [
      { role: 'assistant', content: 'previous response' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is shown here?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
        ],
      },
    ]

    const injected = injectVisualSummaryIntoMessages(messages, '### Image Overview\nA dashboard screenshot')

    expect(injected[0]).toEqual(messages[0])
    expect(typeof injected[1].content).toBe('string')
    expect(injected[1].content).toContain('## Visual Analysis Summary')
    expect(injected[1].content).toContain('## Original User Request')
    expect(injected[1].content).toContain('what is shown here?')
    expect(injected[1].content).not.toContain('abc123')
  })

  it('injects the visual analysis summary into string user content', () => {
    const messages: LLMMessage[] = [
      { role: 'assistant', content: 'previous response' },
      { role: 'user', content: 'please continue' },
    ]

    const injected = injectVisualSummaryIntoMessages(messages, '### Image Overview\nA settings dialog')
    const injectedContent = injected[1].content as string

    expect(injectedContent).toContain('## Visual Analysis Summary')
    expect(injectedContent).toContain('## Original User Request')
    expect(injectedContent).toContain('please continue')
  })

  it('strips image parts from the latest user message for fallback to the primary model', () => {
    const messages: LLMMessage[] = [
      { role: 'assistant', content: 'previous response' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'please inspect this image' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
        ],
      },
    ]

    const stripped = stripImagesFromLatestUserMessage(messages)

    expect(stripped[0]).toEqual(messages[0])
    expect(stripped[1].content).toBe('please inspect this image')
  })
})
