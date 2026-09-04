/**
 * Incremental BM25 keyword index.
 *
 * Search only visits documents referenced by the query's content or symbol
 * postings. The document map owns payloads; postings contain document IDs so
 * incremental replacement and deletion have one authoritative lifecycle.
 */

import { SearchResult } from '../types'

const BM25_K1 = 1.2
const BM25_B = 0.75
const SYMBOL_GRAM_SIZE = 2

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
}

interface IndexedBM25Document extends BM25Document {
  termFreq: Map<string, number>
  docLength: number
  symbolGrams: Set<string>
}

interface ScoredDocument {
  doc: IndexedBM25Document
  score: number
}

export class BM25Index {
  private documents = new Map<string, IndexedBM25Document>()
  private documentsByFile = new Map<string, Set<string>>()
  private contentPostings = new Map<string, Set<string>>()
  private symbolPostings = new Map<string, Set<string>>()
  private totalDocumentLength = 0
  private searchedCandidateCount = 0

  /** Add a document, replacing an existing document with the same ID. */
  addDocument(doc: BM25Document): void {
    const existing = this.documents.get(doc.id)
    if (existing) this.removeDocument(existing)

    const terms = this.tokenize(doc.content)
    const termFreq = new Map<string, number>()
    for (const term of terms) {
      termFreq.set(term, (termFreq.get(term) || 0) + 1)
    }

    const symbolGrams = new Set<string>()
    for (const symbol of doc.symbols) {
      for (const gram of this.createSymbolGrams(symbol)) symbolGrams.add(gram)
    }

    const indexedDocument: IndexedBM25Document = {
      ...doc,
      termFreq,
      docLength: terms.length,
      symbolGrams,
    }

    this.documents.set(doc.id, indexedDocument)
    this.addPosting(this.documentsByFile, doc.relativePath, doc.id)
    this.totalDocumentLength += indexedDocument.docLength

    for (const term of termFreq.keys()) {
      this.addPosting(this.contentPostings, term, doc.id)
    }
    for (const gram of symbolGrams) {
      this.addPosting(this.symbolPostings, gram, doc.id)
    }
  }

  /** Add multiple documents without building a second temporary index. */
  addDocuments(docs: BM25Document[]): void {
    for (const doc of docs) this.addDocument(doc)
  }

  /** Search query-matched candidates and retain only the best topK results. */
  search(query: string, topK: number = 10): SearchResult[] {
    this.searchedCandidateCount = 0
    if (this.documents.size === 0 || topK <= 0) return []

    const queryTerms = [...new Set(this.tokenize(query))]
    if (queryTerms.length === 0) return []

    const candidateIds = new Set<string>()
    for (const term of queryTerms) {
      this.collectPosting(this.contentPostings.get(term), candidateIds)
      this.collectPosting(this.smallestSymbolPosting(term), candidateIds)
    }
    this.searchedCandidateCount = candidateIds.size
    if (candidateIds.size === 0) return []

    const documentCount = this.documents.size
    const averageDocumentLength = this.totalDocumentLength / documentCount || 1
    const queryIdf = new Map(queryTerms.map(term => {
      const frequency = this.contentPostings.get(term)?.size || 0
      return [term, Math.log((documentCount - frequency + 0.5) / (frequency + 0.5) + 1)]
    }))
    const best = new TopKHeap(topK)

    for (const id of candidateIds) {
      const doc = this.documents.get(id)
      if (!doc) continue

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

      for (const symbol of doc.symbols) {
        const lowerSymbol = symbol.toLowerCase()
        for (const term of queryTerms) {
          if (lowerSymbol.includes(term)) score += 2
        }
      }

      if (score > 0) best.push({ doc, score })
    }

    return best.sorted().map(({ doc, score }) => ({
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

  clear(): void {
    this.documents.clear()
    this.documentsByFile.clear()
    this.contentPostings.clear()
    this.symbolPostings.clear()
    this.totalDocumentLength = 0
    this.searchedCandidateCount = 0
  }

  /** Delete every indexed chunk belonging to a file. */
  deleteFile(relativePath: string): boolean {
    const documentIds = this.documentsByFile.get(relativePath)
    if (!documentIds) return false

    for (const id of [...documentIds]) {
      const doc = this.documents.get(id)
      if (doc) this.removeDocument(doc)
    }
    return true
  }

  get size(): number {
    return this.documents.size
  }

  get fileCount(): number {
    return this.documentsByFile.size
  }

  /** Number of content terms with at least one live posting. */
  get vocabularySize(): number {
    return this.contentPostings.size
  }

  /** Number of documents considered by the most recent search. */
  get lastSearchCandidateCount(): number {
    return this.searchedCandidateCount
  }

  private removeDocument(doc: IndexedBM25Document): void {
    this.documents.delete(doc.id)
    this.totalDocumentLength -= doc.docLength
    if (this.totalDocumentLength < 0) this.totalDocumentLength = 0

    this.removePosting(this.documentsByFile, doc.relativePath, doc.id)
    for (const term of doc.termFreq.keys()) {
      this.removePosting(this.contentPostings, term, doc.id)
    }
    for (const gram of doc.symbolGrams) {
      this.removePosting(this.symbolPostings, gram, doc.id)
    }
  }

  private addPosting(index: Map<string, Set<string>>, key: string, documentId: string): void {
    const posting = index.get(key)
    if (posting) posting.add(documentId)
    else index.set(key, new Set([documentId]))
  }

  private removePosting(index: Map<string, Set<string>>, key: string, documentId: string): void {
    const posting = index.get(key)
    if (!posting) return
    posting.delete(documentId)
    if (posting.size === 0) index.delete(key)
  }

  private collectPosting(posting: Set<string> | undefined, candidates: Set<string>): void {
    if (!posting) return
    for (const id of posting) candidates.add(id)
  }

  /**
   * Any exact substring match must contain every query gram. Selecting the
   * smallest posting preserves correctness while minimizing false candidates.
   */
  private smallestSymbolPosting(term: string): Set<string> | undefined {
    let smallest: Set<string> | undefined
    for (const gram of new Set(this.createSymbolGrams(term))) {
      const posting = this.symbolPostings.get(gram)
      if (!posting) return undefined
      if (!smallest || posting.size < smallest.size) smallest = posting
    }
    return smallest
  }

  private createSymbolGrams(symbol: string): string[] {
    const normalized = symbol.toLowerCase()
    if (normalized.length < SYMBOL_GRAM_SIZE) return []

    const grams: string[] = []
    for (let index = 0; index <= normalized.length - SYMBOL_GRAM_SIZE; index++) {
      grams.push(normalized.slice(index, index + SYMBOL_GRAM_SIZE))
    }
    return grams
  }

  /** Tokenize words while preserving and decomposing snake/camel identifiers. */
  private tokenize(text: string): string[] {
    const lexicalTokens = text.match(/[\p{L}\p{N}_]+/gu) || []
    const terms: string[] = []

    for (const lexicalToken of lexicalTokens) {
      const normalized = lexicalToken.toLowerCase()
      const variants = new Set([normalized])
      const components = lexicalToken
        .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
        .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
        .split(/[\s_]+/)

      for (const component of components) variants.add(component.toLowerCase())
      for (const variant of variants) {
        if (variant.length >= 2 && !/^\d+$/.test(variant)) terms.push(variant)
      }
    }

    return terms
  }
}

/** A min-heap whose root is the worst retained result. */
class TopKHeap {
  private values: ScoredDocument[] = []

  constructor(private readonly capacity: number) {}

  push(value: ScoredDocument): void {
    if (this.values.length < this.capacity) {
      this.values.push(value)
      this.bubbleUp(this.values.length - 1)
      return
    }

    if (compareRank(value, this.values[0]) <= 0) return
    this.values[0] = value
    this.sinkDown(0)
  }

  sorted(): ScoredDocument[] {
    return this.values.sort((left, right) => compareRank(right, left))
  }

  private bubbleUp(startIndex: number): void {
    let index = startIndex
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      if (compareRank(this.values[index], this.values[parentIndex]) >= 0) return
      this.swap(index, parentIndex)
      index = parentIndex
    }
  }

  private sinkDown(startIndex: number): void {
    let index = startIndex
    for (;;) {
      const left = index * 2 + 1
      const right = left + 1
      let worst = index

      if (left < this.values.length && compareRank(this.values[left], this.values[worst]) < 0) {
        worst = left
      }
      if (right < this.values.length && compareRank(this.values[right], this.values[worst]) < 0) {
        worst = right
      }
      if (worst === index) return

      this.swap(index, worst)
      index = worst
    }
  }

  private swap(left: number, right: number): void {
    const value = this.values[left]
    this.values[left] = this.values[right]
    this.values[right] = value
  }
}

/** Positive means left ranks ahead of right. IDs make equal scores deterministic. */
function compareRank(left: ScoredDocument, right: ScoredDocument): number {
  if (left.score !== right.score) return left.score - right.score
  if (left.doc.id === right.doc.id) return 0
  return left.doc.id < right.doc.id ? 1 : -1
}
