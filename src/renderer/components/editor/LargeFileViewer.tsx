import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Lock } from 'lucide-react'
import type { OpenFile } from '@store/slices/fileSlice'
import type { TextFileChunk } from '@shared/types/fileChunk'
import { api } from '@renderer/services/electronAPI'

interface LargeFileViewerProps {
  file: OpenFile
  language: 'zh' | 'en'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function LargeFileViewer({ file, language }: LargeFileViewerProps) {
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

  useEffect(() => {
    if (!metadata) return
    setChunk({
      content: file.content,
      startOffset: metadata.startOffset,
      nextOffset: metadata.nextOffset,
      totalSize: metadata.totalSize,
      eof: metadata.eof,
    })
    setHistory([])
    setError(false)
  }, [file.path, file.contentLoadVersion, metadata])

  if (!metadata || !chunk) return null

  const loadChunk = async (offset: number, previousHistory: number[]) => {
    setLoading(true)
    setError(false)
    try {
      const next = await api.file.readTextChunk(file.path, offset, metadata.chunkSize)
      if (!next) {
        setError(true)
        return
      }
      setChunk(next)
      setHistory(previousHistory)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
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
      <textarea
        readOnly
        spellCheck={false}
        value={chunk.content}
        className="min-h-0 flex-1 resize-none whitespace-pre overflow-auto border-0 bg-background p-4 font-mono text-xs leading-5 text-text-primary outline-none"
      />
    </div>
  )
}
