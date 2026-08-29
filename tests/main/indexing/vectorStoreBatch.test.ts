import { describe, expect, it, vi } from 'vitest'
import { VectorStoreService, escapeSqlStringLiteral } from '@main/indexing/vectorStore'
import type { IndexedChunk } from '@main/indexing/types'

function chunk(filePath: string, id: string): IndexedChunk {
  return {
    id,
    filePath,
    relativePath: filePath,
    fileHash: `hash-${id}`,
    content: `content-${id}`,
    startLine: 1,
    endLine: 1,
    type: 'block',
    language: 'typescript',
    symbols: [],
    vector: [1, 2, 3],
  }
}

describe('VectorStoreService batch updates', () => {
  it('replaces several files with one delete and one add', async () => {
    const table = { delete: vi.fn(async (_filter: string) => {}), add: vi.fn(async (_data: unknown[]) => {}) }
    const store = new VectorStoreService('C:/workspace-cache')
    Object.assign(store as unknown as Record<string, unknown>, { db: {}, table })

    await store.upsertFiles([
      { filePath: 'src/a.ts', chunks: [chunk('src/a.ts', 'a')] },
      { filePath: 'src/b.ts', chunks: [chunk('src/b.ts', 'b')] },
    ])

    expect(table.delete).toHaveBeenCalledTimes(1)
    expect(table.delete).toHaveBeenCalledWith("filePath = 'src/a.ts' OR filePath = 'src/b.ts'")
    expect(table.add).toHaveBeenCalledTimes(1)
    expect(table.add.mock.calls[0][0]).toHaveLength(2)
  })

  it('does not add rows when a batch only deletes files', async () => {
    const table = { delete: vi.fn(async (_filter: string) => {}), add: vi.fn(async (_data: unknown[]) => {}) }
    const store = new VectorStoreService('C:/workspace-cache')
    Object.assign(store as unknown as Record<string, unknown>, { db: {}, table })

    await store.upsertFiles([{ filePath: 'src/deleted.ts', chunks: [] }])

    expect(table.delete).toHaveBeenCalledTimes(1)
    expect(table.add).not.toHaveBeenCalled()
  })

  // LanceDB 的 add 是纯追加，对零行删除也不报错。所以「删旧行」这一步
  // 只要静默失败，后面的 add 就在旧行上又叠一份，每次重建索引多一份副本。
  it('does not add rows when the delete failed', async () => {
    const table = {
      delete: vi.fn(async (_filter: string) => {
        throw new Error('table locked')
      }),
      add: vi.fn(async (_data: unknown[]) => {}),
    }
    const store = new VectorStoreService('C:/workspace-cache')
    Object.assign(store as unknown as Record<string, unknown>, { db: {}, table })

    await store.upsertFile('src/a.ts', [chunk('src/a.ts', 'a')])
    await store.upsertFiles([{ filePath: 'src/b.ts', chunks: [chunk('src/b.ts', 'b')] }])

    expect(table.add).not.toHaveBeenCalled()
  })
})

describe('escapeSqlStringLiteral', () => {
  // 早先的实现把 `--` 和 `;` 从路径里删掉，等于把「转义」写成了「改写」：
  // 工作区路径带 `--`（E:/Project/my--app）时删除条件匹配不到任何行。
  it('preserves characters that are harmless inside a quoted literal', () => {
    expect(escapeSqlStringLiteral('E:/Project/my--app/src/a.ts')).toBe('E:/Project/my--app/src/a.ts')
    expect(escapeSqlStringLiteral('E:/Project/a;b/src/a.ts')).toBe('E:/Project/a;b/src/a.ts')
    expect(escapeSqlStringLiteral('E:\\Project\\app\\src\\a.ts')).toBe('E:\\Project\\app\\src\\a.ts')
  })

  it('doubles the only character that can escape the literal', () => {
    expect(escapeSqlStringLiteral("src/o'brien.ts")).toBe("src/o''brien.ts")
    expect(escapeSqlStringLiteral("a' OR '1'='1")).toBe("a'' OR ''1''=''1")
  })

  it('does not truncate long paths', () => {
    const longPath = `src/${'nested/'.repeat(300)}a.ts`
    expect(escapeSqlStringLiteral(longPath)).toHaveLength(longPath.length)
  })
})
