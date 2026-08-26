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
  private documents = new Set<BM25Document>()
  private documentsByFile = new Map<string, Set<BM25Document>>()
  private documentFrequency = new Map<string, number>()
  private totalDocumentLength = 0

  /** 添加文档 */
  addDocument(doc: Omit<BM25Document, 'termFreq' | 'docLength'>): void {
    const terms = this.tokenize(doc.content)
    const termFreq = new Map<string, number>()
    for (const term of terms) {
      termFreq.set(term, (termFreq.get(term) || 0) + 1)
    }
    const indexedDocument = { ...doc, termFreq, docLength: terms.length }
    this.documents.add(indexedDocument)
    const fileDocuments = this.documentsByFile.get(doc.relativePath) || new Set<BM25Document>()
    fileDocuments.add(indexedDocument)
    this.documentsByFile.set(doc.relativePath, fileDocuments)
    this.totalDocumentLength += indexedDocument.docLength
    for (const term of termFreq.keys()) {
      this.documentFrequency.set(term, (this.documentFrequency.get(term) || 0) + 1)
    }
  }

  /** 批量添加文档 */
  addDocuments(docs: Omit<BM25Document, 'termFreq' | 'docLength'>[]): void {
    for (const doc of docs) {
      this.addDocument(doc)
    }
  }

  /** 搜索 */
  search(query: string, topK: number = 10): SearchResult[] {
    if (this.documents.size === 0) return []

    const queryTerms = this.tokenize(query)
    const documentCount = this.documents.size
    const averageDocumentLength = this.totalDocumentLength / documentCount
    const queryIdf = new Map(queryTerms.map(term => {
      const frequency = this.documentFrequency.get(term) || 0
      return [term, Math.log((documentCount - frequency + 0.5) / (frequency + 0.5) + 1)]
    }))
    const scores: { doc: BM25Document; score: number }[] = []

    for (const doc of this.documents) {
      let score = 0

      for (const term of queryTerms) {
        const tf = doc.termFreq.get(term) || 0
        if (tf === 0) continue

        const idf = queryIdf.get(term) || 0
        const numerator = tf * (BM25_K1 + 1)
        const denominator = tf + BM25_K1 * (
          1 - BM25_B + BM25_B * (doc.docLength / averageDocumentLength)
        )
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
    this.documents.clear()
    this.documentsByFile.clear()
    this.documentFrequency.clear()
    this.totalDocumentLength = 0
  }

  /**
   * 删除文件的所有文档
   *
   * 返回是否真的删除了内容。
   */
  deleteFile(relativePath: string): boolean {
    const fileDocuments = this.documentsByFile.get(relativePath)
    if (!fileDocuments) return false

    for (const doc of fileDocuments) {
      this.documents.delete(doc)
      this.totalDocumentLength -= doc.docLength
      for (const term of doc.termFreq.keys()) {
        const nextFrequency = (this.documentFrequency.get(term) || 0) - 1
        if (nextFrequency <= 0) this.documentFrequency.delete(term)
        else this.documentFrequency.set(term, nextFrequency)
      }
    }
    this.documentsByFile.delete(relativePath)
    return true
  }

  /** 获取文档数量 */
  get size(): number {
    return this.documents.size
  }

  get fileCount(): number {
    return this.documentsByFile.size
  }

  /** Number of searchable terms, useful for status and invariant checks. */
  get vocabularySize(): number {
    return this.documentFrequency.size
  }

  /** 分词 */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[\s\W]+/)
      .filter(t => t.length >= 2 && !/^\d+$/.test(t))
  }
}
