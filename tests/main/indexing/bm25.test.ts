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
  it('is searchable immediately after documents are added', () => {
    const idx = new BM25Index()
    idx.addDocument(doc('a', 'a.ts', 'authentication token refresh handler'))
    idx.addDocument(doc('b', 'b.ts', 'unrelated rendering pipeline code'))

    const results = idx.search('authentication token')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].relativePath).toBe('a.ts')
  })

  it('ranks the document with more query-term matches higher', () => {
    const idx = new BM25Index()
    idx.addDocument(doc('a', 'a.ts', 'cache invalidation cache eviction cache policy'))
    idx.addDocument(doc('b', 'b.ts', 'cache mentioned once here'))

    const results = idx.search('cache')
    expect(results[0].relativePath).toBe('a.ts')
  })

  it('boosts documents whose symbols match the query', () => {
    const idx = new BM25Index()
    idx.addDocument(doc('a', 'a.ts', 'shared body text alpha', ['parseWorkspace']))
    idx.addDocument(doc('b', 'b.ts', 'shared body text alpha', []))

    const results = idx.search('parseworkspace')
    expect(results[0].relativePath).toBe('a.ts')
  })

  it('finds camelCase and snake_case identifier components', () => {
    const idx = new BM25Index()
    idx.addDocument(doc('a', 'a.ts', 'function parseWorkspaceIndex() {}'))
    idx.addDocument(doc('b', 'b.ts', 'const structural_index_store = true'))

    expect(idx.search('workspace')[0].relativePath).toBe('a.ts')
    expect(idx.search('structural')[0].relativePath).toBe('b.ts')
  })

  it('supports arbitrary symbol substrings without scanning unrelated documents', () => {
    const idx = new BM25Index()
    idx.addDocument(doc('a', 'a.ts', 'shared text', ['parseWorkspaceIndex']))
    idx.addDocument(doc('b', 'b.ts', 'shared text', ['wordOrder']))

    const results = idx.search('workspace')

    expect(results[0].relativePath).toBe('a.ts')
    expect(idx.lastSearchCandidateCount).toBe(1)
  })

  it('removes every chunk belonging to a deleted file', () => {
    const idx = new BM25Index()
    idx.addDocument(doc('a1', 'a.ts', 'authentication token part one'))
    idx.addDocument(doc('a2', 'a.ts', 'authentication token part two'))
    idx.addDocument(doc('b1', 'b.ts', 'unrelated rendering pipeline'))

    idx.deleteFile('a.ts')

    expect(idx.size).toBe(1)
    expect(idx.search('authentication token')).toHaveLength(0)
  })

  it('drops IDF entries for terms that no longer exist in the corpus', () => {
    const idx = new BM25Index()
    idx.addDocument(doc('a', 'a.ts', 'zzuniqueterm appears only here'))
    idx.addDocument(doc('b', 'b.ts', 'unrelated rendering pipeline'))
    const vocabularyBefore = idx.vocabularySize

    idx.deleteFile('a.ts')

    // 该词已随文件移除，不应残留 IDF 条目（否则评分失真且内存无界增长）
    expect(idx.vocabularySize).toBeLessThan(vocabularyBefore)
  })

  it('recomputes IDF after incremental edits rather than reusing stale values', () => {
    const idx = new BM25Index()
    idx.addDocument(doc('a', 'a.ts', 'rare term here'))
    for (let i = 0; i < 5; i++) {
      idx.addDocument(doc(`f${i}`, `f${i}.ts`, 'common filler text'))
    }
    const rareScoreBefore = idx.search('rare')[0].score

    // 让 "rare" 变成常见词，IDF 应当下降
    for (let i = 0; i < 5; i++) {
      idx.addDocument(doc(`g${i}`, `g${i}.ts`, 'rare term everywhere now'))
    }
    const rareScoreAfter = idx.search('rare')[0].score

    expect(rareScoreAfter).toBeLessThan(rareScoreBefore)
  })

  it('replaces duplicate document IDs without leaving stale postings', () => {
    const idx = new BM25Index()
    idx.addDocument(doc('same', 'old.ts', 'obsolete authentication', ['oldSymbol']))
    idx.addDocument(doc('same', 'new.ts', 'current rendering', ['newSymbol']))

    expect(idx.size).toBe(1)
    expect(idx.fileCount).toBe(1)
    expect(idx.search('obsolete')).toEqual([])
    expect(idx.search('oldsymbol')).toEqual([])
    expect(idx.search('current')[0].relativePath).toBe('new.ts')
  })

  it('returns only the strongest topK results with deterministic ties', () => {
    const idx = new BM25Index()
    idx.addDocument(doc('c', 'c.ts', 'cache'))
    idx.addDocument(doc('b', 'b.ts', 'cache cache'))
    idx.addDocument(doc('a', 'a.ts', 'cache cache'))
    idx.addDocument(doc('d', 'd.ts', 'cache cache cache cache'))

    const results = idx.search('cache', 3)

    expect(results.map(result => result.relativePath)).toEqual(['d.ts', 'a.ts', 'b.ts'])
    expect(idx.search('cache', 0)).toEqual([])
  })

  it('searches a bounded candidate set in a 100,000-document corpus', () => {
    const idx = new BM25Index()
    for (let index = 0; index < 100_000; index++) {
      idx.addDocument(doc(`f${index}`, `f${index}.ts`, 'shared filler rendering pipeline'))
    }
    idx.addDocument(doc('rare-a', 'rare-a.ts', 'needleterm alpha'))
    idx.addDocument(doc('rare-b', 'rare-b.ts', 'needleterm needleterm beta'))
    idx.addDocument(doc('rare-c', 'rare-c.ts', 'needleterm needleterm needleterm gamma'))

    const results = idx.search('needleterm', 2)

    expect(idx.size).toBe(100_003)
    expect(idx.lastSearchCandidateCount).toBe(3)
    expect(results.map(result => result.relativePath)).toEqual(['rare-c.ts', 'rare-b.ts'])
  }, 30_000)

  it('handles an empty index without throwing', () => {
    const idx = new BM25Index()
    expect(idx.search('anything')).toEqual([])
    expect(idx.size).toBe(0)
  })

  it('clears all state', () => {
    const idx = new BM25Index()
    idx.addDocument(doc('a', 'a.ts', 'authentication token refresh'))
    idx.clear()

    expect(idx.size).toBe(0)
    expect(idx.search('authentication')).toEqual([])
    expect(idx.vocabularySize).toBe(0)
  })

})
