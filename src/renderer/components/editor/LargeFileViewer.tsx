import { useEffect, useRef, useState } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { ChevronLeft, ChevronRight, Loader2, Lock } from 'lucide-react'
import type { OpenFile } from '@store/slices/fileSlice'
import type { ThemeName } from '@store/slices/themeSlice'
import type { TextFileChunk } from '@shared/types/fileChunk'
import { api } from '@renderer/services/electronAPI'
import { defineMonacoTheme } from './utils/monacoTheme'

interface LargeFileViewerProps {
  file: OpenFile
  language: 'zh' | 'en'
  theme: ThemeName
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function LargeFileViewer({ file, language, theme }: LargeFileViewerProps) {
  const metadata = file.largeFileView
  const [chunk, setChunk] = useState<TextFileChunk | null>(() => metadata ? {
    content: file.content,
    startOffset: metadata.startOffset,
    nextOffset: metadata.nextOffset,
    totalSize: metadata.totalSize,
    eof: metadata.eof,
  } : null)
  const [history, setHistory] = useState<number[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const requestVersionRef = useRef(0)
  const monacoRef = useRef<Parameters<typeof defineMonacoTheme>[0] | null>(null)

  useEffect(() => {
    if (!monacoRef.current) return
    defineMonacoTheme(monacoRef.current, theme)
    monacoRef.current.editor.setTheme('adnify-dynamic')
  }, [theme])

  useEffect(() => {
    if (!metadata) return
    requestVersionRef.current += 1
    setChunk({
      content: file.content,
      startOffset: metadata.startOffset,
      nextOffset: metadata.nextOffset,
      totalSize: metadata.totalSize,
      eof: metadata.eof,
    })
    setHistory([])
    setLoading(false)
    setError(false)
  }, [file.path, file.contentLoadVersion, metadata])

  if (!metadata || !chunk) return null

  const loadChunk = async (offset: number, previousHistory: number[]) => {
    const requestVersion = ++requestVersionRef.current
    setLoading(true)
    setError(false)
    try {
      const next = await api.file.readTextChunk(file.path, offset, metadata.chunkSize)
      if (requestVersion !== requestVersionRef.current) return
      if (!next) {
        setError(true)
        return
      }
      setChunk(next)
      setHistory(previousHistory)
    } catch {
      if (requestVersion === requestVersionRef.current) setError(true)
    } finally {
      if (requestVersion === requestVersionRef.current) setLoading(false)
    }
  }

  const pageEnd = Math.min(chunk.nextOffset, chunk.totalSize)

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-text-muted">
        <Lock className="h-3.5 w-3.5" />
        <span>{language === 'zh' ? '超大文件只读模式' : 'Very large file · read only'}</span>
        <span className="ml-auto tabular-nums">
          {formatBytes(chunk.startOffset)}–{formatBytes(pageEnd)} / {formatBytes(chunk.totalSize)}
        </span>
        <button
          type="button"
          disabled={loading || history.length === 0}
          className="rounded p-1 hover:bg-surface disabled:opacity-30"
          onClick={() => {
            const previousOffset = history[history.length - 1]
            void loadChunk(previousOffset, history.slice(0, -1))
          }}
          title={language === 'zh' ? '上一页' : 'Previous page'}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled={loading || chunk.eof}
          className="rounded p-1 hover:bg-surface disabled:opacity-30"
          onClick={() => void loadChunk(chunk.nextOffset, [...history, chunk.startOffset])}
          title={language === 'zh' ? '下一页' : 'Next page'}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>
      {error && (
        <div className="border-b border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {language === 'zh' ? '读取这一页失败，请重试。' : 'Could not read this page. Please retry.'}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <MonacoEditor
          key={`${file.path}:${chunk.startOffset}`}
          height="100%"
          defaultLanguage="plaintext"
          defaultValue={chunk.content}
          theme="adnify-dynamic"
          beforeMount={monaco => defineMonacoTheme(monaco, theme)}
          onMount={(_, monaco) => {
            monacoRef.current = monaco
          }}
          options={{
            readOnly: true,
            domReadOnly: true,
            largeFileOptimizations: true,
            minimap: { enabled: false },
            folding: false,
            glyphMargin: false,
            wordWrap: 'off',
            renderWhitespace: 'none',
            renderLineHighlight: 'none',
            guides: { indentation: false, bracketPairs: false },
            matchBrackets: 'never',
            occurrencesHighlight: 'off',
            selectionHighlight: false,
            links: false,
            colorDecorators: false,
            codeLens: false,
            hover: { enabled: false },
            quickSuggestions: false,
            suggestOnTriggerCharacters: false,
            parameterHints: { enabled: false },
            stickyScroll: { enabled: false },
            padding: { top: 8, bottom: 8 },
            scrollBeyondLastLine: false,
          }}
        />
      </div>
    </div>
  )
}
