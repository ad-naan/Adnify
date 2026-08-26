/**
 * TokenCounter 测试
 * 
 * 测试 js-tiktoken 精确 token 计数
 */

import { beforeAll, describe, it, expect } from 'vitest'
import {
  countTokens,
  countContentTokens,
  countMessagesTokens,
  ensureTokenEncoder,
} from '@shared/utils/tokenCounter'

beforeAll(async () => {
  await ensureTokenEncoder()
})

describe('TokenCounter - Basic Counting', () => {
  it('should count English text tokens accurately', () => {
    const text = 'Hello world, this is a test message.'
    const tokens = countTokens(text)
    
    // js-tiktoken 应该给出精确的 token 数
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThan(text.length)
  })

  it('should count Chinese text tokens accurately', () => {
    const chinese = '你好世界，这是一个测试消息。'
    const tokens = countTokens(chinese)
    
    // 中文字符通常占用更多 token
    expect(tokens).toBeGreaterThan(0)
  })

  it('should count mixed language text tokens', () => {
    const mixed = 'Hello 你好 World 世界'
    const tokens = countTokens(mixed)
    
    expect(tokens).toBeGreaterThan(0)
  })

  it('should handle empty string', () => {
    expect(countTokens('')).toBe(0)
  })

  it('should count code tokens', () => {
    const code = 'function hello() { return "world"; }'
    const tokens = countTokens(code)
    
    expect(tokens).toBeGreaterThan(0)
  })
})

describe('TokenCounter - Content Counting', () => {
  it('should count text content', () => {
    const tokens = countContentTokens('Simple text')
    expect(tokens).toBeGreaterThan(0)
  })

  it('should count structured content with text', () => {
    const content = [
      { type: 'text', text: 'Hello world' }
    ]
    const tokens = countContentTokens(content)
    expect(tokens).toBeGreaterThan(0)
  })

  it('should count structured content with image', () => {
    const content = [
      { type: 'text', text: 'Look at this' },
      { type: 'image', source: { data: 'base64...' } }
    ]
    const tokens = countContentTokens(content)
    
    // 应该包含文本 token + 固定的图片 token (1600)
    expect(tokens).toBeGreaterThan(1600)
  })
})

describe('TokenCounter - Message Counting', () => {
  it('should count simple messages with overhead', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' }
    ]
    const tokens = countMessagesTokens(messages)
    
    // 应该包含消息内容 + 结构开销
    expect(tokens).toBeGreaterThan(countTokens('Hello') + countTokens('Hi there!'))
  })

  it('should count messages with tool calls', () => {
    const messages = [
      {
        role: 'assistant',
        content: 'Let me help',
        tool_calls: [
          {
            id: 'call_1',
            name: 'read_file',
            arguments: { path: 'test.ts' }
          }
        ]
      }
    ]
    const tokens = countMessagesTokens(messages)
    
    expect(tokens).toBeGreaterThan(0)
  })
})
