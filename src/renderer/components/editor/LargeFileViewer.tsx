import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { ChevronLeft, ChevronRight, Loader2, Lock } from 'lucide-react'
import type { OpenFile } from '@store/slices/fileSlice'
import type { ThemeName } from '@store/slices/themeSlice'
import type { TextFileChunk } from '@shared/types/fileChunk'
import { api } from '@renderer/services/electronAPI'
import { defineMonacoTheme } from './utils/monacoTheme'
import { LargeFilePageCache } from './largeFilePageCache'
import { t, asLanguage } from '@renderer/i18n'

const PAGE_CACHE_SIZE = 5
const SEEK_STEPS = 1_000

interface LargeFileViewerProps {
  file: OpenFile
  language: 'zh' | 'en'
  theme: ThemeName
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function getProgress(chunk: TextFileChunk): number {
  if (chunk.totalSize <= 0) return 0
  return Math.min(SEEK_STEPS, Math.round((chunk.startOffset / chunk.totalSize) * SEEK_STEPS))
}

export default function LargeFileViewer({ file, language, theme }: LargeFileViewerProps) {
  const metadata = file.largeFileView
  const initialChunk = useMemo<TextFileChunk | null>(() => metadata ? {
    content: file.content,
    startOffset: metadata.startOffset,
    nextOffset: metadata.nextOffset,
    totalSize: metadata.totalSize,
    eof: metadata.eof,
  } : null, [file.content, metadata])
  const [chunk, setChunk] = useState<TextFileChunk | null>(initialChunk)
  const [history, setHistory] = useState<number[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [seekValue, setSeekValue] = useState(() => initialChunk ? getProgress(initialChunk) : 0)
  const requestVersionRef = useRef(0)
  const revealEndRef = useRef(false)
  const monacoRef = useRef<Parameters<typeof defineMonacoTheme>[0] | null>(null)
  const pageCache = useMemo(() => new LargeFilePageCache(PAGE_CACHE_SIZE), [])
  const inFlightReads = useMemo(() => new Map<string, Promise<TextFileChunk | null>>(), [])

  useEffect(() => {
    if (initialChunk) pageCache.set(initialChunk)
  }, [initialChunk, pageCache])

  useEffect(() => {
    if (!monacoRef.current) return
    defineMonacoTheme(monacoRef.current, theme)
    monacoRef.current.editor.setTheme('adnify-dynamic')
  }, [theme])

  const readChunk = useCallback((offset: number, alignStartToLine = false): Promise<TextFileChunk | null> => {
    if (!metadata) return Promise.resolve(null)

    if (!alignStartToLine) {
      const cached = pageCache.get(offset)
      if (cached) return Promise.resolve(cached)
    }

    const requestKey = `${offset}:${alignStartToLine ? 1 : 0}`
    const pending = inFlightReads.get(requestKey)
    if (pending) return pending

    const request = api.file
      .readTextChunk(file.path, offset, metadata.chunkSize, alignStartToLine)
      .then(next => {
        if (next) pageCache.set(next)
        return next
      })
      .finally(() => inFlightReads.delete(requestKey))
    inFlightReads.set(requestKey, request)
    return request
  }, [file.path, inFlightReads, metadata, pageCache])

  const loadChunk = useCallback(async (
    offset: number,
    previousHistory: number[],
    options: { alignStartToLine?: boolean; revealEnd?: boolean } = {},
  ) => {
    const requestVersion = ++requestVersionRef.current
    setLoading(true)
    setError(false)
    try {
      const next = await readChunk(offset, options.alignStartToLine)
      if (requestVersion !== requestVersionRef.current) return
      if (!next) {
        setError(true)
        return
      }

      revealEndRef.current = options.revealEnd === true
      setChunk(next)
      setHistory(previousHistory)
      setSeekValue(getProgress(next))
    } catch {
      if (requestVersion === requestVersionRef.current) setError(true)
    } finally {
      if (requestVersion === requestVersionRef.current) setLoading(false)
    }
  }, [readChunk])

  const loadNext = useCallback(() => {
    if (!chunk || chunk.eof || loading) return
    void loadChunk(chunk.nextOffset, [...history, chunk.startOffset])
  }, [chunk, history, loadChunk, loading])

  const loadPrevious = useCallback((revealEnd = false) => {
    if (!chunk || chunk.startOffset <= 0 || loading || !metadata) return

    const previousOffset = history[history.length - 1]
    if (previousOffset !== undefined) {
      void loadChunk(previousOffset, history.slice(0, -1), { revealEnd })
      return
    }

    const approximateOffset = Math.max(0, chunk.startOffset - metadata.chunkSize)
    void loadChunk(approximateOffset, [], {
      alignStartToLine: approximateOffset > 0,
      revealEnd,
    })
  }, [chunk, history, loadChunk, loading, metadata])

  const seekToProgress = useCallback((progress: number) => {
    if (!chunk || !metadata || loading) return
    const clamped = Math.min(SEEK_STEPS, Math.max(0, progress))
    const approximateOffset = clamped === 0
      ? 0
      : Math.floor((chunk.totalSize - 1) * (clamped / SEEK_STEPS))
    void loadChunk(approximateOffset, [], { alignStartToLine: approximateOffset > 0 })
  }, [chunk, loadChunk, loading, metadata])

  useEffect(() => {
    if (!chunk || chunk.eof) return
    void readChunk(chunk.nextOffset)
  }, [chunk, readChunk])

  if (!metadata || !chunk) return null

  const pageEnd = Math.min(chunk.nextOffset, chunk.totalSize)
  const percentage = chunk.totalSize > 0
    ? Math.min(100, (chunk.startOffset / chunk.totalSize) * 100)
    : 0

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-text-muted">
        <Lock className="h-3.5 w-3.5 shrink-0" />
        <span className="shrink-0">
          {t('largeFileViewer.virtualizedLargeFileRead', asLanguage(language))}
        </span>
        <span className="hidden shrink-0 text-text-muted/70 xl:inline">
          {t('largeFileViewer.scrollAcrossWindowsContinuously', asLanguage(language))}
        </span>
        <span className="ml-auto shrink-0 tabular-nums">
          {percentage.toFixed(1)}% · {formatBytes(chunk.startOffset)}–{formatBytes(pageEnd)} / {formatBytes(chunk.totalSize)}
        </span>
        <input
          aria-label={t('largeFileViewer.seekThroughFile', asLanguage(language))}
          type="range"
          min={0}
          max={SEEK_STEPS}
          value={seekValue}
          disabled={loading}
          className="h-1 w-28 cursor-pointer accent-accent disabled:opacity-40"
          onChange={event => setSeekValue(Number(event.currentTarget.value))}
          onPointerUp={event => seekToProgress(Number(event.currentTarget.value))}
          onKeyUp={event => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
              seekToProgress(Number(event.currentTarget.value))
            }
          }}
        />
        <button
          type="button"
          disabled={loading || chunk.startOffset <= 0}
          className="rounded p-1 hover:bg-surface disabled:opacity-30"
          onClick={() => loadPrevious()}
          title={t('largeFileViewer.previousWindow', asLanguage(language))}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled={loading || chunk.eof}
          className="rounded p-1 hover:bg-surface disabled:opacity-30"
          onClick={loadNext}
          title={t('largeFileViewer.nextWindow', asLanguage(language))}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      </div>
      {error && (
        <div className="border-b border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {t('largeFileViewer.couldNotReadThis', asLanguage(language))}
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
          onMount={(editor, monaco) => {
            monacoRef.current = monaco
            if (revealEndRef.current) {
              revealEndRef.current = false
              requestAnimationFrame(() => editor.setScrollTop(editor.getScrollHeight()))
            }

            const domNode = editor.getDomNode()
            if (!domNode) return
            const handleWheel = (event: WheelEvent) => {
              if (loading) return
              const atTop = editor.getScrollTop() <= 0
              const atBottom = editor.getScrollTop() + editor.getLayoutInfo().height >= editor.getScrollHeight() - 2
              if (event.deltaY > 0 && atBottom && !chunk.eof) {
                event.preventDefault()
                loadNext()
              } else if (event.deltaY < 0 && atTop && chunk.startOffset > 0) {
                event.preventDefault()
                loadPrevious(true)
              }
            }
            domNode.addEventListener('wheel', handleWheel, { passive: false })
            editor.onDidDispose(() => domNode.removeEventListener('wheel', handleWheel))
          }}
          options={{
            readOnly: true,
            domReadOnly: true,
            largeFileOptimizations: true,
            minimap: { enabled: false },
            folding: false,
            glyphMargin: false,
            lineNumbers: 'off',
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 0,
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
