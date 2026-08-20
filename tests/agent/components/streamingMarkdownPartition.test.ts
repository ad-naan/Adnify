import { describe, expect, it } from 'vitest'
import { partitionStreamingMarkdown } from '@renderer/components/agent/streamingMarkdownPartition'

describe('partitionStreamingMarkdown', () => {
  it('keeps the live tail separate from completed markdown blocks', () => {
    expect(partitionStreamingMarkdown('第一段。\n\n**正在输出**')).toEqual({
      completedBlocks: ['第一段。\n\n'],
      activeBlock: '**正在输出**',
      hasOpenFence: false,
    })
  })

  it('does not split blank lines inside an open code fence', () => {
    expect(partitionStreamingMarkdown('说明。\n\n```ts\nconst a = 1\n\nconst b = 2')).toEqual({
      completedBlocks: ['说明。\n\n'],
      activeBlock: '```ts\nconst a = 1\n\nconst b = 2',
      hasOpenFence: true,
    })
  })

  it('stabilizes a closed code fence only after its following boundary', () => {
    expect(partitionStreamingMarkdown('```ts\nconst a = 1\n```\n\n后续')).toEqual({
      completedBlocks: ['```ts\nconst a = 1\n```\n\n'],
      activeBlock: '后续',
      hasOpenFence: false,
    })
  })
})
