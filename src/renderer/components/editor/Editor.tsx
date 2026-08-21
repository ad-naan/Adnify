/**
 * 编辑器主组件
 */
import { useRef, useCallback, useEffect, useState, lazy, Suspense } from 'react'
import MonacoEditor, { OnMount, BeforeMount, loader } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { Eye, Edit, Columns } from 'lucide-react'
import { useStore, useModeStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { t } from '@renderer/i18n'
import { useAgentChangeState } from '@hooks/useAgent'
import { useLspIntegration, useFileSave, useLintCheck } from '@renderer/hooks'
import { toast } from '../common/ToastProvider'
import { getFileName, normalizePath } from '@shared/utils/pathUtils'
import { api } from '@renderer/services/electronAPI'
import { didChangeDocument } from '@services/lspService'
import { getFileInfo } from '@services/largeFileService'
import { getMonacoEditorOptions } from '@renderer/config/monacoConfig'
import { getEditorConfig, saveEditorConfig } from '@renderer/settings'
import { keybindingService } from '@services/keybindingService'
import { monaco } from '@renderer/monacoWorker'
import { initMonacoTypeService } from '@services/monacoTypeService'
import { detectEolFromContent, syncFileEolFromModel } from '@services/fileFormatService'
import { streamingEditService } from '@renderer/agent/services/streamingEditService'
import { composerService } from '@renderer/agent/services/composerService'
import type { StreamingEditState } from '@renderer/agent/types'
import type { ThemeName } from '@store/slices/themeSlice'
import { useEditorBreakpoints } from '@hooks/useEditorBreakpoints'
import { consumePendingNavigation } from '@services/editorNavigation'

// 子组件
import { EditorTabs } from './EditorTabs'
import { EditorBreadcrumbs } from './EditorBreadcrumbs'
import { DiffPreview } from './DiffPreview'
import DiffViewer from './DiffViewer'
import InlineEdit from './InlineEdit'
import EditorContextMenu from './EditorContextMenu'
import { TabContextMenu } from './TabContextMenu'
import { EditorWelcome } from './EditorWelcome'
import { SafeDiffEditor } from './SafeDiffEditor'
import { getFileType, MarkdownPreview, ImagePreview, UnsupportedFile } from './FilePreview'
import { CodeSkeleton } from '../ui/Loading'
import { TaskBoard } from '../plan/TaskBoard'
import { PlanWorkspace } from '../plan/PlanWorkspace'
const BrowserPreviewTab = lazy(() => import('./BrowserPreviewTab'))

function isPlanJsonFile(filePath: string): boolean {
  const normalizedPath = normalizePath(filePath)
  return normalizedPath.includes('/.adnify/plan/') && normalizedPath.endsWith('.json')
}

function getPlanIdFromPlanFilePath(filePath: string): string {
  return getFileName(filePath).replace(/\.json$/i, '')
}

// Hooks
import { useEditorActions, useAICompletion, useEditorEvents, useComposerInlineDiff } from './hooks'
import { getLanguage } from './utils/languageMap'
import { defineMonacoTheme } from './utils/monacoTheme'
import { isPreviewDocumentPath } from '@shared/types/preview'
import { PLAN_BOARD_PATH, isPlanBoardPath } from '@shared/types/planBoard'
import type { EditorConfig as SharedEditorConfig } from '@shared/config/types'

loader.config({ monaco })

const MIN_EDITOR_FONT_SIZE = 8
const MAX_EDITOR_FONT_SIZE = 72
const FONT_ZOOM_STEP = 1

function clampEditorFontSize(fontSize: number) {
  return Math.min(MAX_EDITOR_FONT_SIZE, Math.max(MIN_EDITOR_FONT_SIZE, fontSize))
}

export default function Editor() {
  const workMode = useModeStore(state => state.currentMode)
  const activeFilePath = useStore((state) => state.activeFilePath)
  const activeFile = useStore(useShallow(state => state.openFiles.find(f => f.path === state.activeFilePath)))
  const openFileCount = useStore((state) => state.openFiles.length)
  const legacyPlanFiles = useStore(useShallow(state => state.openFiles.filter(file => isPlanJsonFile(file.path)).map(file => file.path)))
  const isPlanBoardOpen = useStore(state => state.openFiles.some(file => isPlanBoardPath(file.path)))

  // 状态
  const [streamingEdit, setStreamingEdit] = useState<StreamingEditState | null>(null)
  const [showDiffPreview, setShowDiffPreview] = useState(false)
  const [inlineEditState, setInlineEditState] = useState<{
    show: boolean; position: { x: number; y: number }; selectedCode: string; lineRange: [number, number]
  } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; filePath: string } | null>(null)
  const [markdownMode, setMarkdownMode] = useState<'edit' | 'preview' | 'split'>('edit')

  const isContextMenuFileDirty = useStore(state => tabContextMenu ? state.openFiles.find(f => f.path === tabContextMenu.filePath)?.isDirty : false)
  const setActiveFile = useStore((state) => state.setActiveFile)
  const openFile = useStore((state) => state.openFile)
  const updateFileContent = useStore((state) => state.updateFileContent)
  const updateFileDirtyState = useStore((state) => state.updateFileDirtyState)
  const markFileSaved = useStore((state) => state.markFileSaved)
  const setFileEol = useStore((state) => state.setFileEol)
  const language = useStore((state) => state.language)
  const closeFile = useStore((state) => state.closeFile)
  const editorConfig = useStore((state) => state.editorConfig)

  const { pendingChanges, acceptChange, undoChange } = useAgentChangeState()

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | typeof import('monaco-editor/esm/vs/editor/editor.api') | null>(null)
  const cursorDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const setFileScrollPosition = useStore((state) => state.setFileScrollPosition)

  // Hooks
  const { registerProviders, setupDiagnostics, setupLinkNavigation, notifyFileOpened } = useLspIntegration()
  const { saveFile, closeFileWithConfirm, closeOtherFiles, closeAllFiles, closeFilesToRight, triggerAutoSave } = useFileSave()
  const { isLinting, runLintCheck, clearLintErrors, errorCount, warningCount } = useLintCheck()
  const { setupCursorTracking } = useEditorEvents(editorRef)

  const isPreviewDocument = Boolean(activeFile && (activeFile.kind === 'preview' || isPreviewDocumentPath(activeFile.path)))
  const isPlanBoardDocument = isPlanBoardPath(activeFile?.path)

  useComposerInlineDiff(isPreviewDocument || isPlanBoardDocument ? null : activeFilePath, editorRef.current, monacoRef.current)

  const { registerActions } = useEditorActions(setInlineEditState)
  const { registerProvider: registerAIProvider } = useAICompletion(isPreviewDocument || isPlanBoardDocument ? null : activeFilePath)

  const activeLanguage = activeFile && !isPreviewDocument && !isPlanBoardDocument ? getLanguage(activeFile.path) : 'plaintext'
  const activeFileType = activeFile && !isPreviewDocument && !isPlanBoardDocument ? getFileType(activeFile.path) : 'text'
  const activeFileInfo = (activeFile && activeFile.content != null && !isPlanBoardDocument) ? getFileInfo(activeFile.path, activeFile.content) : null
  const currentTheme = useStore((state) => state.currentTheme) as ThemeName
  const fontZoomRafRef = useRef<number | null>(null)
  const fontZoomSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // 断点管理
  useEditorBreakpoints(editorRef.current, isPreviewDocument || isPlanBoardDocument ? null : activeFilePath)

  // 主题变化
  useEffect(() => {
    if (monacoRef.current && currentTheme) {
      defineMonacoTheme(monacoRef.current, currentTheme)
      monacoRef.current.editor.setTheme('adnify-dynamic')
    }
  }, [currentTheme])

  const applyEditorTypography = useCallback((
    editorInstance: editor.IStandaloneCodeEditor,
    config: SharedEditorConfig
  ) => {
    editorInstance.updateOptions({
      fontSize: config.fontSize,
      lineHeight: Math.round(config.fontSize * config.lineHeight),
      fontFamily: config.fontFamily,
    })
  }, [])

  const updateEditorFontSize = useCallback((nextFontSize: number) => {
    const normalizedFontSize = clampEditorFontSize(nextFontSize)
    const currentConfig = useStore.getState().editorConfig
    if (currentConfig.fontSize === normalizedFontSize) return

    const nextConfig: SharedEditorConfig = {
      ...currentConfig,
      fontSize: normalizedFontSize,
    }

    useStore.getState().set('editorConfig', nextConfig)

    if (editorRef.current) {
      applyEditorTypography(editorRef.current, nextConfig)
      if (fontZoomRafRef.current != null) {
        cancelAnimationFrame(fontZoomRafRef.current)
      }
      fontZoomRafRef.current = requestAnimationFrame(() => {
        editorRef.current?.layout()
        fontZoomRafRef.current = null
      })
    }

    if (fontZoomSaveTimeoutRef.current) {
      clearTimeout(fontZoomSaveTimeoutRef.current)
    }
    fontZoomSaveTimeoutRef.current = setTimeout(() => {
      saveEditorConfig({ fontSize: normalizedFontSize })
      fontZoomSaveTimeoutRef.current = null
    }, 120)
  }, [applyEditorTypography])

  const handleEditorWheel = useCallback((event: WheelEvent) => {
    const isZoomModifierPressed = event.ctrlKey || event.metaKey
    if (!isZoomModifierPressed) return

    event.preventDefault()

    const direction = event.deltaY < 0 ? 1 : -1
    const currentFontSize = useStore.getState().editorConfig.fontSize
    updateEditorFontSize(currentFontSize + direction * FONT_ZOOM_STEP)
  }, [updateEditorFontSize])

  useEffect(() => {
    if (!editorRef.current) return
    applyEditorTypography(editorRef.current, editorConfig)
  }, [applyEditorTypography, editorConfig])

  useEffect(() => {
    return () => {
      if (fontZoomRafRef.current != null) {
        cancelAnimationFrame(fontZoomRafRef.current)
      }
      if (fontZoomSaveTimeoutRef.current) {
        clearTimeout(fontZoomSaveTimeoutRef.current)
      }
    }
  }, [])

  // 文件切换时清除 lint 错误并通知 LSP
  // 同时检查是否有跨文件 Go-to-Definition 待处理的跳转定位
  useEffect(() => {
    clearLintErrors()
    if (activeFile && activeFile.content != null && !isPreviewDocument && !isPlanBoardDocument) {
      notifyFileOpened(activeFile.path, activeFile.content)
      // 检查是否有跨文件跳转定义的待定位请求
      const nav = consumePendingNavigation(activeFile.path)
      if (nav && editorRef.current) {
        setTimeout(() => {
          editorRef.current?.setPosition({ lineNumber: nav.line, column: nav.col })
          editorRef.current?.revealPositionInCenter({ lineNumber: nav.line, column: nav.col })
          editorRef.current?.focus()
        }, 80)
      }
    }
  }, [activeFilePath, activeFile, clearLintErrors, notifyFileOpened, isPlanBoardDocument, isPreviewDocument])

  // 清理不再打开的文件的 Monaco Models，防止内存泄漏
  useEffect(() => {
    if (!monacoRef.current) return
    const monacoInstance = monacoRef.current
    const models = monacoInstance.editor.getModels()

    const validUris = new Set(
      useStore.getState().openFiles.map(f => {
        if (f.path.startsWith('diff://') || f.kind === 'preview') return ''
        return monacoInstance.Uri.file(f.path).toString()
      })
    )

    models.forEach(model => {
      const uri = model.uri.toString()
      if (uri.startsWith('inmemory://') || uri.startsWith('internal://')) return

      if (!validUris.has(uri)) {
        model.dispose()
      }
    })
  }, [openFileCount])

  // 流式编辑监听
  useEffect(() => {
    if (!activeFilePath || isPreviewDocument || isPlanBoardDocument) return

    const activeEdit = streamingEditService.getActiveEditForFile(activeFilePath)
    if (activeEdit) {
      setStreamingEdit(activeEdit.state)
      setShowDiffPreview(true)

      const unsubscribe = streamingEditService.subscribe(activeEdit.editId, (state) => {
        setStreamingEdit(state)
        if (state.isComplete) {
          setTimeout(() => setShowDiffPreview(false), 500)
        }
      })
      return unsubscribe
    } else {
      setStreamingEdit(null)
      setShowDiffPreview(false)
    }
  }, [activeFilePath, isPlanBoardDocument, isPreviewDocument])


  const handleBeforeMount: BeforeMount = (monacoInstance) => {
    const { currentTheme } = useStore.getState() as { currentTheme: ThemeName }
    defineMonacoTheme(monacoInstance, currentTheme)
    initMonacoTypeService(monacoInstance)
  }

  const handleEditorMount: OnMount = (editor, monacoInstance) => {
    editorRef.current = editor
    monacoRef.current = monacoInstance
    const disposables: { dispose: () => void }[] = []
    const currentFilePath = activeFilePath

    setupCursorTracking(editor, cursorDebounceRef)
    registerProviders(monacoInstance)
    const unsubscribeDiagnostics = setupDiagnostics(monacoInstance)
    setupLinkNavigation(editor)
    registerActions(editor, monacoInstance)
    registerAIProvider(monacoInstance)
    applyEditorTypography(editor, useStore.getState().editorConfig)

    monacoInstance.editor.setTheme('adnify-dynamic')

    // 恢复文件视图状态
    if (currentFilePath) {
      const { openFiles } = useStore.getState()
      const file = openFiles.find(f => f.path === currentFilePath)
      if (file?.scrollPosition && typeof editor.restoreViewState === 'function') {
        try {
          editor.restoreViewState(file.scrollPosition as any)
        } catch (e) {
          // ignore restore errors
        }
      }
    }

    // 监听滚动变化并保存视图状态
    const scrollDisposable = editor.onDidScrollChange(() => {
      if (currentFilePath && typeof editor.saveViewState === 'function') {
        const state = editor.saveViewState()
        setFileScrollPosition(currentFilePath, state as any)
      }
    })
    disposables.push(scrollDisposable)

    // 监听内容变化，基于版本号更新 dirty 状态
    const model = editor.getModel()
    if (model && currentFilePath) {
      // 初始化时记录版本号
      const { openFiles } = useStore.getState()
      const file = openFiles.find(f => f.path === currentFilePath)
      if (file && !file.savedVersionId) {
        // 首次打开，记录初始版本号
        const { markFileSaved } = useStore.getState()
        markFileSaved(currentFilePath, model.getAlternativeVersionId())
      }
      setFileEol(currentFilePath, detectEolFromContent(model.getValue()))

      const contentDisposable = editor.onDidChangeModelContent(() => {
        const currentVersionId = model.getAlternativeVersionId()
        const editorContent = editor.getValue()
        const { openFiles: currentFiles } = useStore.getState()
        const currentFile = currentFiles.find(f => f.path === currentFilePath)
        syncFileEolFromModel(currentFilePath)

        if (!currentFile) return

        // 如果 savedVersionId 未设置（刚从磁盘重新加载），直接标记为已保存
        if (currentFile.savedVersionId === undefined) {
          markFileSaved(currentFilePath, currentVersionId)
          return
        }

        if (editorContent === currentFile.content) {
          markFileSaved(currentFilePath, currentVersionId)
        } else {
          updateFileDirtyState(currentFilePath, currentVersionId)
        }
      })
      disposables.push(contentDisposable)
    }

    const contextMenuDisposable = editor.onContextMenu((e) => {
      e.event.preventDefault()
      e.event.stopPropagation()
      if (e.target.position) {
        editor.setPosition(e.target.position)
      }
      setContextMenu({ x: e.event.posx, y: e.event.posy })
    })
    disposables.push(contextMenuDisposable)

    const wheelTarget = editor.getDomNode()
    if (wheelTarget) {
      wheelTarget.addEventListener('wheel', handleEditorWheel, { passive: false })
      disposables.push({
        dispose: () => wheelTarget.removeEventListener('wheel', handleEditorWheel)
      })
    }

    editor.onDidDispose(() => {
      unsubscribeDiagnostics()
      disposables.forEach(d => d.dispose())
      disposables.length = 0
    })
  }

  const handleSave = useCallback(async () => {
    if (isPlanBoardDocument) return
    if (activeFile && editorRef.current) {
      const config = getEditorConfig()
      if (config.formatOnSave) {
        const formatAction = editorRef.current.getAction('editor.action.formatDocument')
        if (formatAction) await formatAction.run()
      }
      const content = editorRef.current.getValue()
      const success = await api.file.write(activeFile.path, content, activeFile.encoding)
      if (success) {
        if (config.formatOnSave && content !== activeFile.content) {
          updateFileContent(activeFile.path, content)
        }
        // 保存时记录当前版本号
        const model = editorRef.current.getModel()
        const versionId = model?.getAlternativeVersionId()
        markFileSaved(activeFile.path, versionId)
        toast.success(language === 'zh' ? '文件已保存' : 'File Saved', getFileName(activeFile.path))
      } else {
        toast.error(language === 'zh' ? '保存失败' : 'Save Failed', language === 'zh' ? '无法写入文件' : 'Could not write to file')
      }
    }
  }, [activeFile, isPlanBoardDocument, markFileSaved, language, updateFileContent])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (keybindingService.matches(e.nativeEvent, 'editor.save')) {
      e.preventDefault()
      handleSave()
    }
  }, [handleSave])

  const handleRunLint = useCallback(() => {
    if (activeFilePath && !isPreviewDocument && !isPlanBoardDocument) {
      runLintCheck(activeFilePath, editorRef.current, monacoRef.current)
    }
  }, [activeFilePath, runLintCheck, isPlanBoardDocument, isPreviewDocument])

  // Plan 模式维护一个固定编辑器标签。它只在进入模式时自动激活一次，
  // 此后用户可以自由切换到其他文件；离开模式时强制移除固定标签。
  useEffect(() => {
    legacyPlanFiles.forEach(path => closeFile(path, { force: true }))
    if (workMode === 'plan') {
      if (!isPlanBoardOpen) openFile(PLAN_BOARD_PATH, '', undefined, { pinned: true })
      return
    }
    if (isPlanBoardOpen) closeFile(PLAN_BOARD_PATH, { force: true })
  }, [closeFile, isPlanBoardOpen, legacyPlanFiles, openFile, workMode])

  if (openFileCount === 0) {
    return <EditorWelcome />
  }

  return (
    <div className="h-full flex flex-col bg-background/50 relative overflow-hidden" onKeyDown={handleKeyDown}>
      <EditorTabs
        activeFilePath={activeFilePath}
        onSelectFile={setActiveFile}
        onCloseFile={closeFileWithConfirm}
        onContextMenu={(e, path) => setTabContextMenu({ x: e.clientX, y: e.clientY, filePath: path })}
        lintErrorCount={errorCount}
        lintWarningCount={warningCount}
        isLinting={isLinting}
        onRunLint={handleRunLint}
        activeFileKind={activeFile?.kind}
      />

      {activeFile && !isPreviewDocument && !isPlanBoardDocument && (
        <EditorBreadcrumbs
          filePath={activeFile.path}
          largeFileInfo={activeFileInfo}
          language={language}
        />
      )}

      {/* 流式编辑预览 */}
      {showDiffPreview && streamingEdit && activeFile && (
        <div className="border-b border-border-subtle h-1/2">
          <DiffViewer
            originalContent={streamingEdit.originalContent}
            modifiedContent={streamingEdit.currentContent}
            filePath={streamingEdit.filePath}
            isStreaming={!streamingEdit.isComplete}
            onAccept={() => {
              updateFileContent(activeFile.path, streamingEdit.currentContent)
              composerService.acceptChange(activeFile.path)
              setShowDiffPreview(false)
            }}
            onReject={() => {
              composerService.rejectChange(activeFile.path)
              setShowDiffPreview(false)
            }}
            onClose={() => setShowDiffPreview(false)}
          />
        </div>
      )}

      {/* 内联编辑器 - 极简悬浮胶囊 */}
      {inlineEditState?.show && activeFile && (
        <InlineEdit
          position={inlineEditState.position}
          selectedCode={inlineEditState.selectedCode}
          filePath={activeFile.path}
          lineRange={inlineEditState.lineRange}
          onClose={() => setInlineEditState(null)}
        />
      )}

      {/* 编辑器主体 */}
      <div className="flex-1 relative min-h-0 overflow-visible flex flex-col">
        {isPlanBoardDocument ? (
          <PlanWorkspace />
        ) : activeFile?.path.startsWith('diff://') || activeFile?.path.startsWith('git-diff://') ? (
          <DiffPreview
            diff={{
              original: activeFile.originalContent || '',
              modified: activeFile.content || '',
              filePath: activeFile.path
                .replace(/^(git-)?diff:\/\//, '')
                .replace(/^commit\/[^/]+\//, '')
                .replace(/^stash@\{\d+\}\//, ''),
            }}
            isPending={activeFile.path.startsWith('diff://') && pendingChanges.some(c => c.filePath === activeFile.path.replace(/^(git-)?diff:\/\//, ''))}
            readOnly={activeFile.path.startsWith('git-diff://')}
            language={language}
            onClose={() => closeFile(activeFile.path)}
            onChange={(newContent) => {
              if (activeFile.path.startsWith('git-diff://')) return;
              updateFileContent(activeFile.path, newContent)
            }}
            onAccept={async () => {
              if (activeFile.path.startsWith('git-diff://')) return;
              const realPath = activeFile.path.replace(/^(git-)?diff:\/\//, '')
              acceptChange(realPath)
              await composerService.acceptChange(realPath)
              updateFileContent(realPath, activeFile.content)
              closeFile(activeFile.path)
            }}
            onReject={async () => {
              if (activeFile.path.startsWith('git-diff://')) return;
              const realPath = activeFile.path.replace(/^(git-)?diff:\/\//, '')
              await undoChange(realPath)
              await composerService.rejectChange(realPath)
              closeFile(activeFile.path)
            }}
          />
        ) : isPreviewDocument && activeFile ? (
          <Suspense fallback={<CodeSkeleton lines={8} />}>
            <BrowserPreviewTab file={activeFile} />
          </Suspense>
        ) : activeFile && (
          <>
            {/* Markdown 工具栏 */}
            {activeFileType === 'markdown' && (
              <div className="absolute top-0 right-0 z-10 flex items-center gap-1 px-2 py-1 bg-surface/80 backdrop-blur-sm rounded-bl-lg border-l border-b border-border">
                <button onClick={() => setMarkdownMode('edit')} className={`p-1.5 rounded-md text-xs transition-colors ${markdownMode === 'edit' ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-white/10'}`} title={t('editor.editMode', language)}>
                  <Edit className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setMarkdownMode('split')} className={`p-1.5 rounded-md text-xs transition-colors ${markdownMode === 'split' ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-white/10'}`} title={t('editor.splitMode', language)}>
                  <Columns className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setMarkdownMode('preview')} className={`p-1.5 rounded-md text-xs transition-colors ${markdownMode === 'preview' ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-white/10'}`} title={t('editor.previewMode', language)}>
                  <Eye className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {activeFileType === 'image' ? (
              <ImagePreview path={activeFile.path} />
            ) : activeFileType === 'binary' ? (
              <UnsupportedFile path={activeFile.path} fileType="binary" />
            ) : isPlanJsonFile(activeFile.path) ? (
              <TaskBoard planId={getPlanIdFromPlanFilePath(activeFile.path)} />
            ) : activeFileType === 'markdown' && markdownMode === 'preview' ? (
              <MarkdownPreview content={activeFile.content} fontSize={getEditorConfig().fontSize} sourcePath={activeFile.path} />
            ) : activeFileType === 'markdown' && markdownMode === 'split' ? (
              <div className="flex h-full">
                <div className="flex-1 border-r border-border">
                  <MonacoEditor
                    height="100%"
                    key={activeFile.path}
                    path={monaco.Uri.file(activeFile.path).toString()}
                    language={activeLanguage}
                    value={activeFile.content}
                    theme="adnify-dynamic"
                    beforeMount={handleBeforeMount}
                    onMount={handleEditorMount}
                    onChange={(value) => {
                      if (value !== undefined) {
                        updateFileContent(activeFile.path, value)
                        didChangeDocument(activeFile.path, value)
                      }
                    }}
                    loading={<CodeSkeleton lines={12} />}
                    options={{
                      ...getMonacoEditorOptions(activeFileInfo, editorConfig),
                      minimap: { enabled: false },
                      padding: { top: 16 },
                    }}
                  />
                </div>
                <div className="flex-1 relative overflow-hidden">
                  <MarkdownPreview content={activeFile.content} fontSize={getEditorConfig().fontSize} sourcePath={activeFile.path} />
                </div>
              </div>
            ) : activeFile.originalContent !== undefined ? (
              <SafeDiffEditor
                language={activeLanguage}
                original={activeFile.originalContent}
                modified={activeFile.content}
                onMount={(editor, monacoInstance) => {
                  const modifiedEditor = editor.getModifiedEditor()
                  editorRef.current = modifiedEditor
                  monacoRef.current = monacoInstance
                  modifiedEditor.onDidChangeModelContent(() => {
                    updateFileContent(activeFile.path, modifiedEditor.getValue())
                  })
                }}
                options={{
                  ...getMonacoEditorOptions(activeFileInfo, editorConfig),
                  renderSideBySide: true,
                  readOnly: false,
                  minimap: { enabled: false },
                }}
              />
            ) : (
              <MonacoEditor
                height="100%"
                key={activeFile.path}
                path={monaco.Uri.file(activeFile.path).toString()}
                language={activeLanguage}
                value={activeFile.content}
                theme="adnify-dynamic"
                beforeMount={handleBeforeMount}
                onMount={handleEditorMount}
                onChange={(value) => {
                  if (value !== undefined) {
                    updateFileContent(activeFile.path, value)
                    didChangeDocument(activeFile.path, value)
                    triggerAutoSave(activeFile.path)
                  }
                }}
                loading={<CodeSkeleton lines={12} />}
                options={getMonacoEditorOptions(activeFileInfo, editorConfig)}
              />
            )}
          </>
        )}

        {contextMenu && editorRef.current && (
          <EditorContextMenu x={contextMenu.x} y={contextMenu.y} editor={editorRef.current} onClose={() => setContextMenu(null)} />
        )}
      </div>

      {tabContextMenu && (
        <TabContextMenu
          x={tabContextMenu.x}
          y={tabContextMenu.y}
          filePath={tabContextMenu.filePath}
          onClose={() => setTabContextMenu(null)}
          onCloseFile={closeFileWithConfirm}
          onCloseOthers={closeOtherFiles}
          onCloseAll={closeAllFiles}
          onCloseToRight={closeFilesToRight}
          onSave={saveFile}
          isDirty={isContextMenuFileDirty || false}
          language={language}
        />
      )}
    </div>
  )
}
