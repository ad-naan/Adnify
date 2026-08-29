/**
 * 真机跑一遍 TreeSitterChunker.chunkFile，锁住"同一行起始的重复 id 不外泄"。
 *
 * 为什么要单独一个文件：tests/setup.ts 设置了 global.window，而 web-tree-sitter 0.20
 * 的 UMD 里有 `document = "object"==typeof window ? {currentScript: window.document.currentScript} : null`
 * —— window 存在但 window.document 不存在时直接抛错，解析器根本起不来。
 * vitest 默认按文件隔离，所以这里在模块加载阶段把 window 摘掉，只影响本文件。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (globalThis as any).window

import { describe, expect, it } from 'vitest'
import { TreeSitterChunker } from '@main/indexing/treeSitterChunker'

const SOURCE = `import { Foo } from 'bar'

export class Widget {
  private value = 0

  compute(input: number): number {
    const scaled = input * 2
    return scaled + this.value
  }
}

export function helper(input: string): string {
  const trimmed = input.trim()
  const upper = trimmed.toUpperCase()
  return upper
}

function local(input: string): string {
  const trimmed = input.trim()
  const lower = trimmed.toLowerCase()
  return lower
}
`

describe('TreeSitterChunker.chunkFile', () => {
  it('不产生重复 chunk id（export 声明被双重捕获的回归）', async () => {
    const chunker = new TreeSitterChunker()
    await chunker.init()

    const workspacePath = 'C:/workspace'
    const chunks = await chunker.chunkFile(`${workspacePath}/src/widget.ts`, SOURCE, workspacePath)

    // 解析器起不来时 chunkFile 会静默返回 []，那样断言重复就毫无意义了。
    expect(chunks.length).toBeGreaterThan(0)

    const ids = chunks.map(item => item.id)
    expect(ids).toEqual([...new Set(ids)])

    // 保留的是外层 export_statement 节点，内容包含 export 关键字，没丢东西。
    const widget = chunks.find(item => item.content.includes('class Widget'))
    expect(widget?.content.startsWith('export class Widget')).toBe(true)
  })
})
