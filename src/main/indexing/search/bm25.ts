/**
 * BM25 搜索引擎
 * 轻量级关键词搜索，无需外部依赖
 */

import { SearchResult } from '../types'

const BM25_K1 = 1.2
const BM25_B = 0.75

export interface BM25Document {
  id: string
  filePath: string
  relativePath: string
  content: string
  startLine: number
  endLine: number
  type: string
  language: string
  symbols: string[]
  termFreq: Map<string, number>
  docLength: number
}

export class BM25Index {
  private documents: BM25Document[] = []
  private avgDocLength = 0
  private idf: Map<string, number> = new Map()

  /** 添加文档 */
  addDocument(doc: Omit<BM25Document, 'termFreq' | 'docLength'>): void {
    const terms = this.tokenize(doc.content)
    const termFreq = new Map<string, number>()
    for (const term of terms) {
      termFreq.set(term, (termFreq.get(term) || 0) + 1)
    }
    this.documents.push({ ...doc, termFreq, docLength: terms.length })
  }

  /** 批量添加文档 */
  addDocuments(docs: Omit<BM25Document, 'termFreq' | 'docLength'>[]): void {
    for (const doc of docs) {
      this.addDocument(doc)
    }
  }

  /** 构建索引（计算 IDF） */
  build(): void {
    // 先清空：增量更新会让部分词彻底离开语料库，
    // 若保留旧条目，这些词的 IDF 会一直参与评分，且 Map 无界增长。
    this.idf.clear()

    if (this.documents.length === 0) {
      this.avgDocLength = 0
      return
    }

    // 平均文档长度
    const totalLength = this.documents.reduce((sum, doc) => sum + doc.docLength, 0)
    this.avgDocLength = totalLength / this.documents.length

    // 计算 IDF
    const docFreq = new Map<string, number>()
    for (const doc of this.documents) {
      const seenTerms = new Set<string>()
      for (const term of doc.termFreq.keys()) {
        if (!seenTerms.has(term)) {
          docFreq.set(term, (docFreq.get(term) || 0) + 1)
          seenTerms.add(term)
        }
      }
    }

    const N = this.documents.length
    for (const [term, df] of docFreq) {
      this.idf.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1))
    }
  }

  /** 搜索 */
  search(query: string, topK: number = 10): SearchResult[] {
    if (this.documents.length === 0) return []

    const queryTerms = this.tokenize(query)
    const scores: { doc: BM25Document; score: number }[] = []

    for (const doc of this.documents) {
      let score = 0

      for (const term of queryTerms) {
        const tf = doc.termFreq.get(term) || 0
        if (tf === 0) continue

        const idf = this.idf.get(term) || 0
        const numerator = tf * (BM25_K1 + 1)
        const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (doc.docLength / this.avgDocLength))
        score += idf * (numerator / denominator)
      }

      // 符号匹配加分
      for (const symbol of doc.symbols) {
        const lowerSymbol = symbol.toLowerCase()
        for (const term of queryTerms) {
          if (lowerSymbol.includes(term)) {
            score += 2
          }
        }
      }

      if (score > 0) {
        scores.push({ doc, score })
      }
    }

    scores.sort((a, b) => b.score - a.score)

    return scores.slice(0, topK).map(({ doc, score }) => ({
      filePath: doc.filePath,
      relativePath: doc.relativePath,
      content: doc.content,
      startLine: doc.startLine,
      endLine: doc.endLine,
      score: score / 10,
      type: doc.type,
      language: doc.language,
    }))
  }

  /** 清空 */
  clear(): void {
    this.documents = []
    this.idf.clear()
    this.avgDocLength = 0
  }

  /**
   * 删除文件的所有文档
   *
   * 返回是否真的删除了内容，供调用者判断能否跳过 build()。
   * 注意：文档数变化后 IDF 已失效，调用者需在批量删除结束后调用 build()。
   */
  deleteFile(relativePath: string): boolean {
    const before = this.documents.length
    this.documents = this.documents.filter(doc => doc.relativePath !== relativePath)
    return this.documents.length !== before
  }

  /** 获取文档数量 */
  get size(): number {
    return this.documents.length
  }

  /** 序列化为 JSON */
  toJSON(): { documents: BM25Document[]; avgDocLength: number; idf: [string, number][] } {
    return {
      documents: this.documents.map(doc => ({
        ...doc,
        termFreq: Array.from(doc.termFreq.entries()),
      })) as unknown as BM25Document[],
      avgDocLength: this.avgDocLength,
      idf: Array.from(this.idf.entries()),
    }
  }

  /** 从 JSON 恢复 */
  fromJSON(data: { documents: unknown[]; avgDocLength: number; idf: [string, number][] }): void {
    this.documents = data.documents.map((doc: unknown) => {
      const d = doc as BM25Document & { termFreq: [string, number][] }
      return {
        ...d,
        termFreq: new Map(d.termFreq),
      }
    })
    this.avgDocLength = data.avgDocLength
    this.idf = new Map(data.idf)
  }

  /** 分词 */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[\s\W]+/)
      .filter(t => t.length >= 2 && !/^\d+$/.test(t))
  }
}
