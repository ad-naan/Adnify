import { describe, expect, it } from 'vitest'
import { MessageConverter } from '@/main/services/llm/core/MessageConverter'
import type { LLMMessage } from '@shared/types'

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
