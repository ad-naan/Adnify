import { describe, expect, it } from 'vitest'
import { BM25Index } from '@main/indexing/search/bm25'

/** 构造一个最小可用的文档，只需覆盖被测字段 */
function doc(id: string, relativePath: string, content: string, symbols: string[] = []) {
  return {
    id,
    filePath: `/ws/${relativePath}`,
    relativePath,
    content,
    startLine: 1,
    endLine: 10,
    type: 'function',
    language: 'typescript',
    symbols,
  }
}

describe('BM25Index', () => {
  it('returns nothing before build and finds matches after', () => {
    const idx = new BM25Index()
    idx.addDocument(doc('a', 'a.ts', 'authentication token refresh handler'))
    idx.addDocument(doc('b', 'b.ts', 'unrelated rendering pipeline code'))
    idx.build()

    const results = idx.search('authentication token')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].relativePath).toBe('a.ts')
  })

  it('ranks the document with more query-term matches higher', () => {
    const idx = new BM25Index()
    idx.addDocument(doc('a', 'a.ts', 'cache invalidation cache eviction cache policy'))
    idx.addDocument(doc('b', 'b.ts', 'cache mentioned once here'))
    idx.build()

    const results = idx.search('cache')
    expect(results[0].relativePath).toBe('a.ts')
  })

  it('boosts documents whose symbols match the query', () => {
    const idx = new BM25Index()
    idx.addDocument(doc('a', 'a.ts', 'shared body text alpha', ['parseWorkspace']))
    idx.addDocument(doc('b', 'b.ts', 'shared body text alpha', []))
    idx.build()

    const results = idx.search('parseworkspace')
    expect(results[0].relativePath).toBe('a.ts')
  })

  it('survives a serialization round-trip with identical ranking', () => {
    const idx = new BM25Index()
    idx.addDocument(doc('a', 'a.ts', 'authentication token refresh handler'))
    idx.addDocument(doc('b', 'b.ts', 'unrelated rendering pipeline code'))
    idx.build()
    const before = idx.search('authentication token')

    const restored = new BM25Index()
    restored.fromJSON(JSON.parse(JSON.stringify(idx.toJSON())))

    expect(restored.size).toBe(idx.size)
    expect(restored.search('authentication token')).toEqual(before)
  })

  it('removes every chunk belonging to a deleted file', () => {
    const idx = new BM25Index()
    idx.addDocument(doc('a1', 'a.ts', 'authentication token part one'))
    idx.addDocument(doc('a2', 'a.ts', 'authentication token part two'))
    idx.addDocument(doc('b1', 'b.ts', 'unrelated rendering pipeline'))
    idx.build()

    idx.deleteFile('a.ts')
    idx.build()

    expect(idx.size).toBe(1)
    expect(idx.search('authentication token')).toHaveLength(0)
  })

  it('drops IDF entries for terms that no longer exist in the corpus', () => {
    const idx = new BM25Index()
    idx.addDocument(doc('a', 'a.ts', 'zzuniqueterm appears only here'))
    idx.addDocument(doc('b', 'b.ts', 'unrelated rendering pipeline'))
    idx.build()
    expect(idx.toJSON().idf.some(([term]) => term === 'zzuniqueterm')).toBe(true)

    idx.deleteFile('a.ts')
    idx.build()

    // 该词已随文件移除，不应残留 IDF 条目（否则评分失真且内存无界增长）
    expect(idx.toJSON().idf.some(([term]) => term === 'zzuniqueterm')).toBe(false)
  })

  it('recomputes IDF after incremental edits rather than reusing stale values', () => {
    const idx = new BM25Index()
    idx.addDocument(doc('a', 'a.ts', 'rare term here'))
    for (let i = 0; i < 5; i++) {
      idx.addDocument(doc(`f${i}`, `f${i}.ts`, 'common filler text'))
    }
    idx.build()
    const rareIdfBefore = new Map(idx.toJSON().idf).get('rare')!

    // 让 "rare" 变成常见词，IDF 应当下降
    for (let i = 0; i < 5; i++) {
      idx.addDocument(doc(`g${i}`, `g${i}.ts`, 'rare term everywhere now'))
    }
    idx.build()
    const rareIdfAfter = new Map(idx.toJSON().idf).get('rare')!

    expect(rareIdfAfter).toBeLessThan(rareIdfBefore)
  })

  it('handles an empty index without throwing', () => {
    const idx = new BM25Index()
    idx.build()
    expect(idx.search('anything')).toEqual([])
    expect(idx.size).toBe(0)
  })

  it('clears all state', () => {
    const idx = new BM25Index()
    idx.addDocument(doc('a', 'a.ts', 'authentication token refresh'))
    idx.build()
    idx.clear()

    expect(idx.size).toBe(0)
    expect(idx.search('authentication')).toEqual([])
    expect(idx.toJSON().idf).toEqual([])
  })
})
