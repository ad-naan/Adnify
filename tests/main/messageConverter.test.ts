import { describe, expect, it } from 'vitest'
import { MessageConverter } from '@/main/services/llm/core/MessageConverter'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText } from 'ai'
import type { LLMConfig, LLMMessage } from '@shared/types'

describe('MessageConverter AI SDK 7 file parts', () => {
  it('converts legacy internal base64 images into file parts', () => {
    const messages: LLMMessage[] = [{
      role: 'user',
      content: [
        { type: 'text', text: 'Inspect this image' },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: 'base64-image-data',
          },
        },
      ],
    }]

    const converted = new MessageConverter().convert(messages)
    const userContent = converted[0]?.role === 'user' ? converted[0].content : undefined

    expect(userContent).toEqual([
      { type: 'text', text: 'Inspect this image' },
      {
        type: 'file',
        mediaType: 'image/png',
        data: { type: 'data', data: 'base64-image-data' },
      },
    ])
  })

  it('converts image URLs into tagged file URL data', () => {
    const converted = new MessageConverter().convert([{
      role: 'user',
      content: [{
        type: 'image',
        source: {
          type: 'url',
          media_type: 'image/jpeg',
          data: 'https://example.com/image.jpg',
        },
      }],
    }])
    const userContent = converted[0]?.role === 'user' ? converted[0].content : undefined

    expect(userContent).toEqual([{
      type: 'file',
      mediaType: 'image/jpeg',
      data: { type: 'url', url: new URL('https://example.com/image.jpg') },
    }])
  })
})

describe('MessageConverter cache-friendly system prompt', () => {
  it('separates the stable policy prefix from the runtime environment tail', () => {
    const converted = new MessageConverter().convert(
      [],
      'Stable policy\n\n## Environment\n- Active File: app.ts',
    )

    expect(converted).toEqual([
      { role: 'system', content: 'Stable policy' },
      { role: 'system', content: '## Environment\n- Active File: app.ts' },
    ])
  })
})

describe('MessageConverter reasoning replay', () => {
  const config = {
    provider: 'deepseek', protocol: 'openai', model: 'reasoner', enableThinking: true,
  } as LLMConfig
  const reasoning = 'Check the file before answering.\nThen verify the result.'
  const toolCall = {
    id: 'call_1', type: 'function' as const,
    function: { name: 'read_file', arguments: '{"path":"app.ts"}' },
  }

  it.each<[string, Pick<LLMMessage, 'content' | 'tool_calls'>, boolean]>([
    ['text reply', { content: 'The answer.' }, true],
    ['reasoning-only reply', { content: '' }, true],
    ['tool call', { content: '', tool_calls: [toolCall] }, true],
    ['text and tool call', { content: 'Reading now.', tool_calls: [toolCall] }, true],
    ['saved history after thinking is disabled', { content: 'The answer.' }, false],
  ])('sends saved reasoning in the actual compatible API request: %s', async (_name, reply, enableThinking) => {
    const history: LLMMessage[] = [
      { role: 'user', content: 'Inspect app.ts' },
      { role: 'assistant', reasoning_content: reasoning, ...reply },
      ...('tool_calls' in reply
        ? [{ role: 'tool' as const, content: 'file content', tool_call_id: 'call_1', name: 'read_file' }]
        : [{ role: 'user' as const, content: 'Continue' }]),
    ]
    let request: { messages: Array<Record<string, unknown>> } | undefined
    const provider = createOpenAICompatible({
      name: 'custom-openai', baseURL: 'https://example.invalid/v1', apiKey: 'test',
      fetch: async (_url, init) => {
        request = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({
          id: 'response-1', object: 'chat.completion', created: 0, model: 'reasoner',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Done.' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }), { headers: { 'content-type': 'application/json' } })
      },
    })

    await generateText({
      model: provider(config.model), maxRetries: 0,
      messages: new MessageConverter().convert(history, undefined, { ...config, enableThinking }),
    })

    const assistant = request?.messages.find(message => message.role === 'assistant')
    expect(assistant?.reasoning_content).toBe(reasoning)
    expect(assistant?.content).toBe(reply.content || ('tool_calls' in reply ? null : ''))
    if ('tool_calls' in reply) expect(assistant?.tool_calls).toEqual([toolCall])
    expect(request?.messages.filter(message => message.role !== 'assistant')
      .every(message => !('reasoning_content' in message))).toBe(true)
  })

  it.each([undefined, 'custom'] as const)('replays reasoning for a compatible route with protocol %s', protocol => {
    const result = new MessageConverter().convert([
      { role: 'assistant', content: 'Answer', reasoning_content: reasoning },
    ], undefined, { ...config, protocol })
    expect(result[0].content).toEqual([
      { type: 'reasoning', text: reasoning }, { type: 'text', text: 'Answer' },
    ])
  })

  it('does not invent reasoning for older history without it', () => {
    const result = new MessageConverter().convert([
      { role: 'assistant', content: 'Answer' },
      { role: 'assistant', content: '', tool_calls: [toolCall] },
    ], undefined, config)
    expect(result[0].content).toBe('Answer')
    expect(result[1].content).toEqual([
      { type: 'tool-call', toolCallId: 'call_1', toolName: 'read_file', input: { path: 'app.ts' } },
    ])
  })

  it('preserves signed Anthropic thinking before tool calls', () => {
    const result = new MessageConverter().convert([
      { role: 'assistant', content: '', reasoning_content: reasoning, reasoning_signature: 'signature', tool_calls: [toolCall] },
    ], undefined, { ...config, provider: 'anthropic', protocol: 'anthropic', thinkingBudget: 1024 })
    expect(result[0].content).toEqual([
      { type: 'reasoning', text: reasoning, providerOptions: { anthropic: { signature: 'signature' } } },
      { type: 'tool-call', toolCallId: 'call_1', toolName: 'read_file', input: { path: 'app.ts' } },
    ])
  })

  it.each([
    { provider: 'openai', protocol: 'openai' },
    { provider: 'custom', protocol: 'openai-responses' },
    { provider: 'custom', protocol: 'google' },
  ] as const)('does not send compatible reasoning to $provider/$protocol', route => {
    const result = new MessageConverter().convert([
      { role: 'assistant', content: 'Answer', reasoning_content: reasoning },
    ], undefined, { ...config, ...route })
    expect(result[0]).toEqual({ role: 'assistant', content: 'Answer' })
  })
})
