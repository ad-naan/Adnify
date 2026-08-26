/**
 * 符号索引
 * 快速查找函数、类、变量等符号
 */

import { SymbolInfo, SymbolKind } from '../types'

export class SymbolIndex {
  private byName: Map<string, SymbolInfo[]> = new Map()
  private byFile: Map<string, SymbolInfo[]> = new Map()

  /** 添加符号 */
  add(symbol: SymbolInfo): void {
    // 按名称索引
    const byNameList = this.byName.get(symbol.name) || []
    byNameList.push(symbol)
    this.byName.set(symbol.name, byNameList)

    // 按文件索引
    const byFileList = this.byFile.get(symbol.relativePath) || []
    byFileList.push(symbol)
    this.byFile.set(symbol.relativePath, byFileList)
  }

  /** 批量添加 */
  addBatch(symbols: SymbolInfo[]): void {
    for (const symbol of symbols) {
      this.add(symbol)
    }
  }

  /** 搜索符号 */
  search(query: string, topK: number = 20): SymbolInfo[] {
    const lowerQuery = query.toLowerCase()
    const results: { symbol: SymbolInfo; score: number }[] = []

    for (const [name, symbols] of this.byName) {
      const lowerName = name.toLowerCase()
      let score = 0

      // 精确匹配
      if (lowerName === lowerQuery) {
        score = 100
      }
      // 前缀匹配
      else if (lowerName.startsWith(lowerQuery)) {
        score = 80
      }
      // 包含匹配
      else if (lowerName.includes(lowerQuery)) {
        score = 50
      }
      // 驼峰/下划线分词匹配
      else {
        const parts = this.splitIdentifier(name)
        for (const part of parts) {
          if (part.toLowerCase().startsWith(lowerQuery)) {
            score = 30
            break
          }
        }
      }

      if (score > 0) {
        for (const symbol of symbols) {
          results.push({ symbol, score })
        }
      }
    }

    results.sort((a, b) => b.score - a.score)
    return results.slice(0, topK).map(r => r.symbol)
  }

  /** 按类型过滤搜索 */
  searchByKind(query: string, kind: SymbolKind, topK: number = 20): SymbolInfo[] {
    return this.search(query, topK * 2)
      .filter(s => s.kind === kind)
      .slice(0, topK)
  }

  /** 获取文件的所有符号 */
  getFileSymbols(relativePath: string): SymbolInfo[] {
    return this.byFile.get(relativePath) || []
  }

  /** 获取所有唯一符号名 */
  getAllNames(): string[] {
    return Array.from(this.byName.keys())
  }

  /** 清空 */
  clear(): void {
    this.byName.clear()
    this.byFile.clear()
  }

  /** 删除文件的所有符号 */
  deleteFile(relativePath: string): void {
    const symbols = this.byFile.get(relativePath)
    if (!symbols) return

    // 从 byName 中删除这些符号
    for (const symbol of symbols) {
      const list = this.byName.get(symbol.name)
      if (list) {
        const filtered = list.filter(s => s.relativePath !== relativePath)
        if (filtered.length === 0) {
          this.byName.delete(symbol.name)
        } else {
          this.byName.set(symbol.name, filtered)
        }
      }
    }

    // 从 byFile 中删除
    this.byFile.delete(relativePath)
  }

  /** 符号数量 */
  get size(): number {
    return this.byName.size
  }

  /** 文件数量 */
  get fileCount(): number {
    return this.byFile.size
  }

  /** 分割标识符 */
  private splitIdentifier(name: string): string[] {
    return name
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .split(/\s+/)
  }
}
