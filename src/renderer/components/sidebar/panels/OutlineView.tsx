/**
 * 大纲视图 - 显示当前文件的符号结构
 */

import { useState, useEffect, useCallback } from 'react'
import { ChevronRight, FileText, Code, Hash, Braces, Box, Loader2 } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import type { LspDocumentSymbol } from '@shared/types'
import { getFileName } from '@shared/utils/pathUtils'
import { logger } from '@utils/Logger'
import { getDocumentSymbols } from '@services/lspService'

export function OutlineView() {
  const { activeFilePath, language, isLspReady } = useStore(useShallow(s => ({ activeFilePath: s.activeFilePath, language: s.language, isLspReady: s.isLspReady })))
  const [symbols, setSymbols] = useState<LspDocumentSymbol[]>([])
  const [expandedSymbols, setExpandedSymbols] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(false)
  const [filter, setFilter] = useState('')

  // 加载符号
  useEffect(() => {
    logger.ui.info('[OutlineView] Check conditions:', { activeFilePath, isLspReady })
    if (!activeFilePath || !isLspReady) {
      setSymbols([])
      return
    }

    const loadSymbols = async () => {
      setIsLoading(true)
      try {
        logger.ui.info('[OutlineView] Loading symbols for:', activeFilePath)
        const result = await getDocumentSymbols(activeFilePath)
        logger.ui.info('[OutlineView] Got symbols:', result?.length || 0)
        setSymbols(result || [])
        // 默认展开第一层
        const firstLevel = new Set(result?.map((s: LspDocumentSymbol) => s.name) || [])
        setExpandedSymbols(firstLevel)
      } catch (e) {
        logger.ui.error('Failed to load symbols:', e)
        setSymbols([])
      } finally {
        setIsLoading(false)
      }
    }

    loadSymbols()
  }, [activeFilePath, isLspReady])

  const toggleSymbol = (name: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedSymbols((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  // 点击符号跳转到对应行
  const handleSymbolClick = useCallback(
    (symbol: LspDocumentSymbol) => {
      if (!activeFilePath || !symbol.range?.start) return

      window.dispatchEvent(
        new CustomEvent('editor:goto-line', {
          detail: {
            line: symbol.range.start.line + 1,
            column: symbol.range.start.character + 1,
          },
        })
      )
    },
    [activeFilePath]
  )

  const getSymbolIcon = (kind: number | undefined) => {
    switch (kind) {
      case 5: // Class
      case 10: // Enum
        return <Box className="w-3.5 h-3.5 text-orange-400" />
      case 6: // Method
      case 12: // Function
        return <Code className="w-3.5 h-3.5 text-purple-400" />
      case 8: // Field
      case 13: // Variable
      case 14: // Constant
        return <Hash className="w-3.5 h-3.5 text-blue-400" />
      case 11: // Interface
        return <Braces className="w-3.5 h-3.5 text-green-400" />
      default:
        return <Code className="w-3.5 h-3.5 text-text-muted" />
    }
  }

  const renderSymbol = (symbol: LspDocumentSymbol, depth = 0, parentKey = '') => {
    const hasChildren = symbol.children && symbol.children.length > 0
    const isExpanded = expandedSymbols.has(symbol.name)
    const matchesFilter = !filter || symbol.name.toLowerCase().includes(filter.toLowerCase())

    if (!matchesFilter && !hasChildren) return null

    const uniqueKey = `${parentKey}/${symbol.name}-${symbol.kind ?? 0}-${symbol.range?.start?.line ?? 0}-${symbol.range?.start?.character ?? 0}`

    return (
      <div key={uniqueKey}>
        <div
          onClick={() => handleSymbolClick(symbol)}
          className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-surface-hover group transition-colors rounded-md mx-2 my-0.5 border border-transparent hover:border-border-subtle"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {hasChildren ? (
            <button onClick={(e) => toggleSymbol(symbol.name, e)} className="p-0.5 hover:bg-surface-active rounded text-text-muted hover:text-text-primary">
              <ChevronRight
                className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              />
            </button>
          ) : (
            <span className="w-4" />
          )}
          {getSymbolIcon(symbol.kind)}
          <span className="text-xs text-text-secondary group-hover:text-text-primary truncate flex-1 transition-colors">{symbol.name}</span>
          <span className="text-[10px] text-text-muted opacity-0 group-hover:opacity-100 tabular-nums font-mono">
            {symbol.range?.start?.line !== undefined ? symbol.range.start.line + 1 : ''}
          </span>
        </div>

        {hasChildren && isExpanded && <div>{symbol.children!.map((child, idx) => renderSymbol(child, depth + 1, `${uniqueKey}-${idx}`))}</div>}
      </div>
    )
  }

  const fileName = activeFilePath ? getFileName(activeFilePath) : ''

  return (
    <div className="flex flex-col h-full bg-transparent">
      <div className="h-11 px-4 flex items-center justify-between border-b border-border/30 bg-transparent sticky top-0 z-10">
        <span className="text-[10px] font-black text-text-primary/45 uppercase tracking-[0.2em] font-sans">
          {language === 'zh' ? '大纲视图' : 'OUTLINE'}
        </span>
        {isLoading && <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />}
      </div>

      {/* 搜索过滤 */}
      <div className="px-3 py-3 border-b border-border/50">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={language === 'zh' ? '过滤符号...' : 'Filter symbols...'}
          className="w-full bg-surface border border-border-subtle rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:border-accent/50 focus:ring-1 focus:ring-accent/20 focus:outline-none transition-all placeholder:text-text-muted/50"
        />
      </div>

      {/* 当前文件 */}
      {activeFilePath && (
        <div className="px-3 py-2 border-b border-border bg-transparent">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <FileText className="w-3.5 h-3.5 opacity-70" />
            <span className="truncate font-medium">{fileName}</span>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar py-1">
        {!activeFilePath ? (
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center select-none animate-fade-in">
            <div className="w-14 h-14 rounded-2xl bg-surface/40 border border-border/50 flex items-center justify-center mb-4 text-text-muted relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-accent/20 to-accent-subtle/10 rounded-2xl blur opacity-30 group-hover:opacity-50 transition duration-500" />
              <FileText className="w-6 h-6 text-text-muted relative opacity-70" />
            </div>
            <p className="text-xs font-semibold text-text-primary mb-1 tracking-wide">
              {language === 'zh' ? '无活动编辑器' : 'No active file'}
            </p>
            <p className="text-[10px] text-text-muted leading-relaxed max-w-[190px] mx-auto opacity-70">
              {language === 'zh' ? '请在编辑器中打开一个代码文件以查看大纲符号结构。' : 'Open a document to display its structured outline view.'}
            </p>
          </div>
        ) : symbols.length === 0 && !isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center select-none animate-fade-in">
            <div className="w-14 h-14 rounded-2xl bg-surface/40 border border-border/50 flex items-center justify-center mb-4 text-text-muted relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-accent/20 to-accent-subtle/10 rounded-2xl blur opacity-30 group-hover:opacity-50 transition duration-500" />
              <Code className="w-6 h-6 text-text-muted relative opacity-70" />
            </div>
            <p className="text-xs font-semibold text-text-primary mb-1 tracking-wide">
              {language === 'zh' ? '没有找到任何符号' : 'No symbols found'}
            </p>
            <p className="text-[10px] text-text-muted leading-relaxed max-w-[190px] mx-auto opacity-70">
              {language === 'zh' ? '此文件不包含大纲结构，或者分析引擎尚未就绪。' : 'No methods, classes or variables were found in this file.'}
            </p>
          </div>
        ) : (
          symbols.map((symbol, idx) => renderSymbol(symbol, 0, String(idx)))
        )}
      </div>
    </div>
  )
}
