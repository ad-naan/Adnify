/**
 * 结构化索引崩溃回归：重复的 chunk id
 *
 * 背景：chunk id 是 `${filePath}:${startPosition.row}`，而 TS/JS 的查询同时匹配
 * (function_declaration) 与 (export_statement (function_declaration))，于是每个
 * `export function` / `export class` 都会被捕获两次、起始行相同、id 相同。
 * chunks 表是 PRIMARY KEY (generation, relative_path, id) 且用普通 INSERT，
 * 结构化索引（默认模式）因此在第一批就抛 UNIQUE constraint failed，整个构建被带崩。
 * 本仓库自身实测：5 个文件里 11 个重复 id。
 *
 * chunkFile 无法在 vitest 里驱动（tests/setup.ts 设了 global.window，
 * web-tree-sitter 0.20 的 UMD 会去读 window.document.currentScript 而抛错），
 * 所以这里覆盖被抽出的纯函数，真实 SQL 侧的兜底见 structuralIndexStore.test.ts。
 */

import { describe, expect, it } from 'vitest'
import { dedupeById } from '@main/indexing/treeSitterChunker'
import type { CodeChunk } from '@main/indexing/types'

function chunk(id: string, overrides: Partial<CodeChunk> = {}): CodeChunk {
  return {
    id,
    filePath: 'C:/workspace/src/example.ts',
    relativePath: 'src/example.ts',
    fileHash: 'hash',
    content: `content-${id}`,
    startLine: 1,
    endLine: 4,
    type: 'function',
    language: 'typescript',
    symbols: [],
    ...overrides,
  }
}

describe('dedupeById', () => {
  it('丢弃重复 id，保留第一个出现的块', () => {
    // 复刻 export_statement / function_declaration 双重捕获：
    // 外层节点先出现（captures 按 startIndex 排序），其 text 包含内层声明。
    const outer = chunk('src/example.ts:53', { content: 'export class Foo {}', type: 'class' })
    const inner = chunk('src/example.ts:53', { content: 'class Foo {}', type: 'class' })

    const result = dedupeById([outer, inner])

    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('export class Foo {}')
  })

  it('保持其余块的顺序与内容不变', () => {
    const chunks = [chunk('a:1'), chunk('a:10'), chunk('a:1'), chunk('a:20')]

    expect(dedupeById(chunks).map(c => c.id)).toEqual(['a:1', 'a:10', 'a:20'])
  })

  it('gap 块与主捕获用不同 id 命名空间，不会被误删', () => {
    const chunks = [chunk('a:0'), chunk('a:gap:0')]

    expect(dedupeById(chunks)).toHaveLength(2)
  })

  it('无重复时原样返回', () => {
    const chunks = [chunk('a:1'), chunk('a:2')]

    expect(dedupeById(chunks)).toEqual(chunks)
  })

  it('空数组与单元素数组不炸', () => {
    expect(dedupeById([])).toEqual([])
    expect(dedupeById([chunk('a:1')])).toHaveLength(1)
  })
})
