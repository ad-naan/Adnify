import { describe, expect, it } from 'vitest'
import {
  partitionStreamingMarkdown,
  StreamingMarkdownPartitioner,
} from '@renderer/components/agent/streamingMarkdownPartition'
import { fixMarkdownTables } from '@renderer/utils/markdownTableFixer'

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

  it('matches full partitioning across append-only stream updates', () => {
    const partitioner = new StreamingMarkdownPartitioner()
    const chunks = [
      '第一段。',
      '\n\n',
      '| A | B |\n',
      '|---|\n',
      '| 1 | 2 |\n\n',
      '```ts\n',
      'const a = 1\n\n',
      'const b = 2\n',
      '```\n\n',
      '结束',
    ]
    let content = ''

    for (const chunk of chunks) {
      content += chunk
      expect(partitioner.update(content, true)).toEqual(partitionStreamingMarkdown(content))
    }
  })

  it('retains finalized block references instead of rebuilding stream history', () => {
    const partitioner = new StreamingMarkdownPartitioner()
    const first = partitioner.update('第一段。\n\n正在', true)
    const second = partitioner.update('第一段。\n\n正在输出', true)

    // 没有新块收尾：列表引用与块字符串都原样传下去，React 那侧不会重渲染已完成的块
    expect(second.completedBlocks).toBe(first.completedBlocks)
    expect(second.completedBlocks[0]).toBe(first.completedBlocks[0])

    const third = partitioner.update('第一段。\n\n正在输出。\n\n下一段', true)
    expect(third.completedBlocks[0]).toBe(first.completedBlocks[0])
    // 有新块收尾时拷一份，而不是原地 push：上一次返回的 partition 是调用方还持有的值
    expect(third.completedBlocks).not.toBe(second.completedBlocks)
    expect(second.completedBlocks).toHaveLength(1)
    expect(third.completedBlocks).toHaveLength(2)
  })

  it('update 是幂等的：同一对入参连续调用返回同一个 partition，不会把文字数两遍', () => {
    const partitioner = new StreamingMarkdownPartitioner()
    partitioner.update('第一段。\n\n', true)

    const once = partitioner.update('第一段。\n\n第二段。\n\n尾部', true)
    // StrictMode 会把 useMemo 的计算函数跑两遍
    const twice = partitioner.update('第一段。\n\n第二段。\n\n尾部', true)

    expect(twice).toBe(once)
    expect(twice.completedBlocks).toHaveLength(2)
    expect(twice.activeBlock).toBe('尾部')
  })

  it('resets when streamed content is replaced or shortened', () => {
    const partitioner = new StreamingMarkdownPartitioner()
    partitioner.update('旧内容。\n\n旧尾部', true)

    const replacement = '新内容。\n\n新尾部'
    expect(partitioner.update(replacement, true)).toEqual(partitionStreamingMarkdown(replacement))

    const shortened = '短内容'
    expect(partitioner.update(shortened, true)).toEqual(partitionStreamingMarkdown(shortened))
  })

  it('fully rebuilds once when append-only streaming ends', () => {
    const partitioner = new StreamingMarkdownPartitioner()
    const original = `旧开头。\n\n${'相同尾部'.repeat(20)}`
    const corrected = `新开头。\n\n${'相同尾部'.repeat(20)}`

    partitioner.update(original, true)
    expect(partitioner.update(corrected, false)).toEqual(partitionStreamingMarkdown(corrected))
  })

  it('preserves whole-document table normalization when blocks render separately', () => {
    const content = [
      '说明。\n\n',
      '| A | B | C |\n|---|---|\n| 1 | 2 |\n\n',
      '尾部。',
    ].join('')
    const partition = partitionStreamingMarkdown(content)
    const normalizedBlocks = [
      ...partition.completedBlocks.map(fixMarkdownTables),
      fixMarkdownTables(partition.activeBlock),
    ].join('')

    expect(normalizedBlocks).toBe(fixMarkdownTables(content))
  })
})
