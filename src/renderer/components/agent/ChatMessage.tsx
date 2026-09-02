/**
 * 聊天消息组件
 * Linear / Apple 风格：完全左对齐，用户消息右对齐气泡
 * 新设计：极致排版，支持 Tooltip
 */

import React, { useState, useCallback, useEffect } from 'react'
import { Copy, Check, Edit2, RotateCcw, ChevronDown, X, Wrench, FileText, Code, Folder, Link2, Server } from 'lucide-react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import { SyntaxHighlighter } from '@renderer/utils/syntaxHighlighter'
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { themeManager } from '../../config/themeConfig'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChatMessage as ChatMessageType, isUserMessage, isAssistantMessage, getMessageText, getMessageImages, AssistantPart, isTextPart, isToolCallPart, isReasoningPart, isSearchPart, isSystemAlertPart, isLintCheckPart, isContextSnapshotPart, isSourcesPart, ToolCall, } from '@renderer/agent/types'
import type { LLMStreamSource } from '@/shared/types/llm'
import type { SystemAlertPart } from '@renderer/agent/types'
import { WorktreeLanePanel } from '@/renderer/components/git'
import { LintCheckCard } from './LintCheckCard'
import ToolCallGroup, { renderToolCallCard } from './ToolCallGroup'
import { InteractiveCard } from './InteractiveCard'
import { buildInteractiveResponse } from '@/renderer/agent/utils/interactiveResponse'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { MessageBranchActions } from './BranchControls'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Tooltip } from '../ui/Tooltip'
import { LazyImage } from '../common/LazyImage'
import { SystemAlert, parseSystemAlert } from './SystemAlert'
import { CompressionDigestCard } from './CompressionDigestCard'
import { t } from '@shared/i18n'
import { api } from '@/renderer/services/electronAPI'
import { safeOpenFile } from '@renderer/utils/fileUtils'
import { writeClipboardText } from '@/renderer/services/clipboardService'
import { toFullPath, getFileName } from '@shared/utils/pathUtils'
import { stripToolCallLeaks } from '@renderer/agent/utils/toolCallLeakFilter'
import { selectLiveState, type LiveSelectorState } from './chatMessageLiveSelector'
import { fixMarkdownTables } from '@renderer/utils/markdownTableFixer'
import { ImageLightbox } from './ImageLightbox'
import { projectAssistantTurn, type AssistantProcessSummary } from './assistantTurnProjection'
import { OtterAsset } from '@/renderer/components/brand/OtterAsset'
import { StreamingMarkdownPartitioner } from './streamingMarkdownPartition'
import { skillService } from '@/renderer/agent/services/skillService'
import { logger } from '@shared/utils/Logger'
import { buildChatMessagePartKeys } from './chatMessagePartKeys'
import { parseThreadDeepLink } from '@/renderer/agent/threads/threadReference'

interface ChatMessageProps {
  message: ChatMessageType
  onEdit?: (messageId: string, newContent: string) => void
  onRegenerate?: (messageId: string) => void
  onRestore?: (messageId: string) => void
  onApproveTool?: () => void
  onApproveToolForTask?: () => void
  onRejectTool?: () => void
  onStopTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
  onSelectOption?: (messageId: string, selectedIds: string[]) => void
  pendingToolId?: string
  hasCheckpoint?: boolean
  isAwaitingApproval?: boolean
}

interface RenderPartProps {
  part: AssistantPart
  index: number
  pendingToolId?: string
  onApproveTool?: () => void
  onApproveToolForTask?: () => void
  onRejectTool?: () => void
  onStopTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
  fontSize: number
  isStreaming?: boolean
  messageId: string
}

const MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkMath]
const MARKDOWN_REHYPE_PLUGINS = [rehypeKatex]

// 代码块组件 - 更加精致的玻璃质感
const CodeBlock = React.memo(({ language, children, fontSize }: { language: string | undefined; children: React.ReactNode; fontSize: number }) => {
  const [copied, setCopied] = useState(false)
  const currentTheme = useStore(s => s.currentTheme)
  const theme = themeManager.getThemeById(currentTheme)
  const syntaxStyle = theme?.type === 'light' ? vs : vscDarkPlus

  // Flatten text from children
  const codeText = React.useMemo(() => {
    let text = ''

    React.Children.forEach(children, child => {
      if (typeof child === 'string') {
        text += child
      } else if (Array.isArray(child)) {
        child.forEach(c => {
          if (typeof c === 'string') text += c
        })
      }
    })

    if (!text && typeof children === 'string') text = children

    return text.replace(/\n$/, '')
  }, [children])

  const handleCopy = useCallback(async () => {
    const success = await writeClipboardText(codeText)
    if (!success) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [codeText])

  return (
    <div className="relative group/code my-4 rounded-xl overflow-hidden border border-border bg-background-tertiary shadow-sm">
      <div className="flex items-center justify-between px-4 py-2 bg-surface/50 border-b border-border/50">
        <span className="text-[10px] text-text-muted font-bold font-mono uppercase tracking-widest opacity-70">
          {language || 'text'}
        </span>
        <Tooltip content="Copy Code">
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </Tooltip>
      </div>
      <div className="relative">
        <SyntaxHighlighter
          style={syntaxStyle}
          language={language}
          PreTag="div"
          className="!bg-transparent !p-4 !m-0 custom-scrollbar leading-relaxed font-mono"
          customStyle={{ backgroundColor: 'transparent', margin: 0, fontSize: `${fontSize}px` }}
          wrapLines
          wrapLongLines
        >
          {codeText}
        </SyntaxHighlighter>
      </div>
    </div>
  )
})

CodeBlock.displayName = 'CodeBlock'

const StableStreamingMarkdownBlock = React.memo(({
  content,
  components,
}: {
  content: string
  components: Record<string, React.ComponentType<any> | keyof React.JSX.IntrinsicElements>
}) => (
  <ReactMarkdown
    className="prose prose-invert max-w-none"
    remarkPlugins={MARKDOWN_REMARK_PLUGINS}
    rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
    components={components as any}
    urlTransform={(url) => parseThreadDeepLink(url) ? url : defaultUrlTransform(url)}
    skipHtml
  >
    {fixMarkdownTables(content)}
  </ReactMarkdown>
))

StableStreamingMarkdownBlock.displayName = 'StableStreamingMarkdownBlock'

// ThinkingBlock 组件 - 扁平化折叠样式
interface ThinkingBlockProps {
  content: string
  startTime?: number
  isStreaming: boolean
  fontSize: number
}

// 统一上下文面板 — 单个折叠块，无边框扁平设计
interface MessageMetaGroupProps {
  autoSkills?: any[]
  manualSkills?: any[]
  searchContent?: string
  isSearchStreaming?: boolean
}

const MessageMetaGroup = React.memo(({ autoSkills, manualSkills, searchContent, isSearchStreaming }: MessageMetaGroupProps) => {
  // Hooks 必须在所有条件返回之前调用（React 规则）
  const { openFile, setActiveFile, workspacePath, expandAgentBlocksByDefault, language } = useStore(useShallow(s => ({
    openFile: s.openFile,
    setActiveFile: s.setActiveFile,
    workspacePath: s.workspacePath,
    expandAgentBlocksByDefault: s.agentConfig.expandAgentBlocksByDefault ?? false,
    language: s.language,
  })))
  const [isExpanded, setIsExpanded] = useState(expandAgentBlocksByDefault)

  const hasAutoSkills = autoSkills && autoSkills.length > 0
  const hasManualSkills = manualSkills && manualSkills.length > 0
  const hasSearch = searchContent !== undefined || isSearchStreaming
  const hasSkills = hasAutoSkills || hasManualSkills
  const isStreaming = isSearchStreaming

  if (!hasSkills && !hasSearch) return null

  const handleOpenSkill = async (e: React.MouseEvent, skillId: string) => {
    e.stopPropagation()
    try {
      // 1. 优先通过 skillService 扫描定位技能文件
      const loadedSkills = await skillService.getAllSkills()
      const matched = loadedSkills.find(
        s => s.name === skillId || s.name.toLowerCase() === skillId.toLowerCase()
      )

      let targetPath: string | null = matched?.filePath || null

      // 2. 候选项目路径主动探测
      if (!targetPath && workspacePath) {
        const candidates = [
          `${workspacePath}/.adnify/skills/${skillId}/SKILL.md`,
          `${workspacePath}/.claude/skills/${skillId}/SKILL.md`,
          `${workspacePath}/.cursor/skills/${skillId}/SKILL.md`,
          `${workspacePath}/.codex/skills/${skillId}/SKILL.md`,
          `${workspacePath}/skills/${skillId}/SKILL.md`,
        ]
        for (const c of candidates) {
          const norm = c.replace(/\//g, '\\')
          try {
            if (await api.file.exists(norm)) {
              targetPath = norm
              break
            }
          } catch {
            // ignore
          }
        }
      }

      // 3. 全局候选目录主动探测
      if (!targetPath) {
        try {
          const globalDirs = await api.skills.getGlobalDirs()
          for (const gDir of globalDirs) {
            if (!gDir) continue
            const cPath = `${gDir}/${skillId}/SKILL.md`.replace(/\//g, '\\')
            if (await api.file.exists(cPath)) {
              targetPath = cPath
              break
            }
          }
        } catch {
          // ignore
        }
      }

      if (targetPath) {
        try {
          await api.file.authorizeSettingsEdit(targetPath)
        } catch {
          // ignore
        }

        const result = await safeOpenFile(targetPath, { language, confirmLargeFile: false })
        if (result.success) {
          return
        }
      }

      // 如果有技能内容但文件路径不可访问，使用 fallback 方式在编辑器打开
      if (matched?.content) {
        const fallbackPath = `${workspacePath || '.'}/.adnify/skills/${skillId}/SKILL.md`.replace(/\//g, '\\')
        openFile(fallbackPath, matched.content)
        setActiveFile(fallbackPath)
        return
      }

      logger.agent.warn(`[ChatMessage] Skill not found: ${skillId}`)
    } catch (err) {
      logger.agent.error(`[ChatMessage] Failed to open skill ${skillId}:`, err)
    }
  }

  // 折叠时的摘要
  const allSkills = [...(autoSkills || []), ...(manualSkills || [])]
  const skillNames = allSkills.map((s: any) => s.skillId).join(', ')

  return (
    <div className="overflow-hidden w-full my-0.5 animate-fade-in relative z-10">
      {/* 标题行 */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-1.5 py-1 cursor-pointer select-none group text-text-muted/50 hover:text-text-secondary transition-colors"
      >
        <motion.div animate={{ rotate: isExpanded ? 0 : -90 }} transition={{ duration: 0.15 }} className="shrink-0 text-text-muted/40 group-hover:text-text-muted transition-colors">
          <ChevronDown className="w-3.5 h-3.5" />
        </motion.div>

        {isStreaming && (
          <div className="shrink-0 w-3 h-3 rounded-full bg-accent/20 flex items-center justify-center border border-accent/30 mr-0.5">
            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          </div>
        )}

        <span className={`text-[12px] shrink-0 whitespace-nowrap ${isStreaming ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary transition-colors'}`}>
          {t('chatMessage.context', language)}
        </span>

        {/* 折叠时低噪极简摘要 */}
        {!isExpanded && (
          <span className="text-[11px] text-text-muted/40 truncate min-w-0 flex-1 ml-1 font-mono whitespace-nowrap">
            {hasSkills ? `— ${skillNames}` : (hasSearch ? (t('chatMessage.fileSearch', language)) : '')}
          </span>
        )}
      </div>

      {/* 展开内容 */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={false}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <motion.div
              initial={{ opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -2 }}
              transition={{ duration: 0.12, ease: 'easeOut' }}
              className="pt-1 pb-1.5 pl-[20px] pr-2 space-y-2"
            >
              {/* 引用技能 */}
              {hasSkills && (
                <div className="space-y-1">
                  <div className="text-[11px] text-text-muted/60 select-none whitespace-nowrap">
                    {t('chatMessage.skillReferenced', language)}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {allSkills.map((item: any, i: number) => (
                      <button
                        key={item.skillId || i}
                        onClick={(e) => handleOpenSkill(e, item.skillId)}
                        className="inline-flex items-center px-1.5 py-0.5 rounded bg-surface/70 hover:bg-surface-hover text-text-muted hover:text-text-primary font-mono text-[11px] border border-border/40 hover:border-border/70 transition-colors cursor-pointer select-none whitespace-nowrap focus:outline-none"
                        title={t('chatMessage.viewSkill', language, { skillId: item.skillId })}
                      >
                        @{item.skillId}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 相关文件 */}
              {hasSearch && (
                <div className="space-y-1">
                  <div className="text-[11px] text-text-muted/60 select-none whitespace-nowrap">
                    {t('chatMessage.fileReferenced', language)}
                  </div>
                  {searchContent ? (
                    <div className="text-[11px] text-text-muted/70 leading-relaxed font-mono whitespace-pre-wrap break-words max-h-32 overflow-auto custom-scrollbar">
                      {searchContent}
                    </div>
                  ) : (
                    <div className="text-text-muted/40 italic text-[11px]">
                      {t('chatMessage.searchingFiles', language)}
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})
MessageMetaGroup.displayName = 'MessageMetaGroup'

function buildProcessSummaryText(summary: AssistantProcessSummary, language: 'zh' | 'en'): string {
  const items: string[] = []

  if (summary.toolCallCount > 0) {
    // 英文要区分单复数，中文两键同文 —— 复数规则留在 locale 表里，调用点只挑键。
    const key = summary.toolCallCount > 1 ? 'chatMessage.toolCalls' : 'chatMessage.toolCall'
    items.push(t(key, language, { count: summary.toolCallCount }))
  }

  if (summary.hasReasoning) {
    items.push(t('chatMessage.thinking', language))
  }

  if (summary.hasSearch) {
    items.push(t('searchPlaceholder', language))
  }

  if (summary.hasContext) {
    items.push(t('chatMessage.context', language))
  }

  if (summary.hasSources) {
    items.push(t('chatMessage.sources', language))
  }

  if (summary.hasLintCheck) {
    items.push(t('chatMessage.checks', language))
  }

  if (summary.hasSystemAlert) {
    items.push(t('chatMessage.alerts', language))
  }

  if (summary.hasProcessText) {
    items.push(t('chatMessage.notes', language))
  }

  return items.join(' · ')
}

interface ProcessFoldProps {
  children: React.ReactNode
  language: 'zh' | 'en'
  summary: AssistantProcessSummary
}

const ProcessFoldDivider = React.memo(({ side }: { side: 'left' | 'right' }) => (
  <div className="relative h-px flex-1 overflow-hidden rounded-full bg-border/45">
    <div
      className={`absolute inset-0 ${
        side === 'left'
          ? 'bg-gradient-to-r from-transparent via-border/60 to-accent/15'
          : 'bg-gradient-to-r from-accent/15 via-border/60 to-transparent'
      }`}
    />
  </div>
))
ProcessFoldDivider.displayName = 'ProcessFoldDivider'

const ProcessFold = React.memo(({ children, language, summary }: ProcessFoldProps) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const summaryText = buildProcessSummaryText(summary, language)
  const titleText = summaryText || (t('chatMessage.process', language))
  const detailLabel = isExpanded
    ? (t('chatMessage.hideDetails', language))
    : (t('chatMessage.viewProcess', language))

  return (
    <div className="my-3 w-full">
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded(prev => !prev)}
        className="group flex w-full items-center gap-2 text-left text-text-muted/55 transition-colors hover:text-text-secondary"
      >
        <ProcessFoldDivider side="left" />
        <div className="process-fluid-pill shrink-0">
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
          <span className="truncate font-medium text-text-secondary">{titleText}</span>
          <span className="shrink-0 text-text-muted/45">· {detailLabel}</span>
        </div>
        <ProcessFoldDivider side="right" />
      </button>

      {isExpanded && (
        <div className="mt-2 w-full space-y-1 text-[11px] text-text-secondary [&>*]:my-0.5">
          {children}
        </div>
      )}
    </div>
  )
})
ProcessFold.displayName = 'ProcessFold'

const ThinkingBlock = React.memo(({ content, startTime, isStreaming, fontSize }: ThinkingBlockProps) => {
  const expandAgentBlocksByDefault = useStore(s => s.agentConfig.expandAgentBlocksByDefault ?? false)
  const [isExpanded, setIsExpanded] = useState(expandAgentBlocksByDefault)
  const [elapsed, setElapsed] = useState<number>(0)
  const lastElapsed = React.useRef<number>(0)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [shadowClass, setShadowClass] = useState('')

  useEffect(() => {
    if (!startTime || !isStreaming) return
    const timer = setInterval(() => {
      const current = Math.floor((Date.now() - startTime) / 1000)
      setElapsed(current)
      lastElapsed.current = current
    }, 1000)
    return () => clearInterval(timer)
  }, [startTime, isStreaming])

  // 检测滚动位置，显示/隐藏阴影
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !isExpanded) return
    const checkScroll = () => {
      const hasTop = el.scrollTop > 0
      const hasBottom = el.scrollTop < el.scrollHeight - el.clientHeight - 1
      setShadowClass([hasTop ? 'shadow-top' : '', hasBottom ? 'shadow-bottom' : ''].filter(Boolean).join(' '))
    }
    checkScroll()
    el.addEventListener('scroll', checkScroll)
    return () => el.removeEventListener('scroll', checkScroll)
  }, [isExpanded, content])


  // 流式输出时自动滚动到底部
  useEffect(() => {
    if (isStreaming && isExpanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [content, isStreaming, isExpanded])

  const durationText = !isStreaming
    ? (lastElapsed.current > 0 ? `Thought for ${lastElapsed.current}s` : 'Thought')
    : `Thinking for ${elapsed}s...`

  return (
    <div className="my-3 group/think overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 py-1.5 text-text-muted/50 hover:text-text-muted rounded-md hover:bg-text-primary/[0.03] transition-colors select-none"
      >
        <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-0' : '-rotate-90'}`}>
          <ChevronDown className="w-3.5 h-3.5" />
        </div>
        <span className="text-[12px]">
          {durationText}
        </span>
      </button>

      {isExpanded && (
        <div className={`relative scroll-shadow-container ${isStreaming ? 'animate-slide-down' : ''} ${shadowClass}`}>
          <div
            ref={scrollRef}
            className="max-h-[300px] overflow-y-auto scrollbar-none pl-[38px] pr-3 pb-3"
          >
            {content ? (
              <div
                style={{ fontSize: `${fontSize - 1}px` }}
                className={`text-text-muted/70 leading-relaxed whitespace-pre-wrap font-sans ${isStreaming ? 'animate-block-reveal' : ''}`}
              >
                {content}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-text-muted/50 italic text-xs py-1">
                <span className="text-shimmer">Analyzing...</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
})
ThinkingBlock.displayName = 'ThinkingBlock'

// Markdown 渲染组件
const MarkdownContent = React.memo(({ content: rawContent, fontSize, isStreaming }: { content: string; fontSize: number; isStreaming?: boolean }) => {
  const content = typeof rawContent === 'string' ? rawContent : String(rawContent ?? '')
  const streamedInThisMountRef = React.useRef(false)
  if (isStreaming) streamedInThisMountRef.current = true
  const keepStreamingLayout = streamedInThisMountRef.current

  // 所有 useMemo 必须在前面
  const cleanedContent = React.useMemo(() => {
    // Live text was filtered before entering the store. Settled and historical
    // messages keep one defensive pass for older persisted data.
    return isStreaming ? content.trim() : stripToolCallLeaks(content)
  }, [content, isStreaming])

  // 检测系统警告
  const systemAlert = React.useMemo(() => {
    if (!isStreaming) {
      return parseSystemAlert(cleanedContent)
    }
    return null
  }, [cleanedContent, isStreaming])

  // 如果检测到系统警告，移除原始文本中的警告部分
  const contentWithoutAlert = React.useMemo(() => {
    if (systemAlert) {
      // 移除 ⚠️ 和 💡 部分
      return cleanedContent.replace(/⚠️\s*.+?(?:\n💡\s*.+)?$/s, '').trim()
    }
    return cleanedContent
  }, [cleanedContent, systemAlert])

  const streamingPartitioner = React.useMemo(() => new StreamingMarkdownPartitioner(), [])
  const streamingPartition = React.useMemo(
    () => keepStreamingLayout ? streamingPartitioner.update(contentWithoutAlert, !!isStreaming) : null,
    [contentWithoutAlert, isStreaming, keepStreamingLayout, streamingPartitioner],
  )

  const workspacePath = useStore(s => s.workspacePath)

  const handleOpenFile = React.useCallback(async (filePath: string) => {
    if (!workspacePath) return
    const resolvedPath = toFullPath(filePath, workspacePath)

    try {
      await safeOpenFile(resolvedPath, { showWarning: false, confirmLargeFile: false })
    } catch (err) {
      console.warn('Failed to open file from markdown:', err)
    }
  }, [workspacePath])

  const markdownComponents = React.useMemo(() => ({
    code({ className, children, node, ...props }: any) {
      const match = /language-(\w+)/.exec(className || '')
      const codeContent = String(children)
      const isCodeBlock = match || node?.position?.start?.line !== node?.position?.end?.line
      const isInline = !isCodeBlock && !codeContent.includes('\n')

      const looksLikePath = isInline && (
        codeContent.includes('/') ||
        codeContent.includes('\\') ||
        codeContent.match(/\.(ts|tsx|js|jsx|vue|uvue|md|json|css|scss|less|html|go|rs|py|java|c|cpp|h|hpp)$/i)
      ) && !codeContent.includes(' ') && codeContent.length > 2

      if (isInline && looksLikePath) {
        return (
          <code
            className="bg-surface-muted px-1.5 py-0.5 rounded-md text-accent font-mono text-[0.9em] border border-border break-all cursor-pointer hover:underline decoration-accent/50 underline-offset-2 transition-all"
            onClick={(e) => {
              e.preventDefault()
              handleOpenFile(codeContent)
            }}
            title="Click to open file"
            {...props}
          >
            {children}
          </code>
        )
      }

      return isInline ? (
        <code className="bg-surface-muted px-1.5 py-0.5 rounded-md text-accent font-mono text-[0.9em] border border-border break-all" {...props}>
          {children}
        </code>
      ) : (
        <div className="w-full relative">
          <CodeBlock language={match?.[1]} fontSize={fontSize}>{children}</CodeBlock>
        </div>
      )
    },
    pre: ({ children }: any) => <div className="overflow-x-auto max-w-full">{children}</div>,
    p: ({ children }: any) => <p className="mb-3 last:mb-0 leading-7 break-words">{children}</p>,
    ul: ({ children }: any) => <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>,
    ol: ({ children }: any) => <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>,
    li: ({ children }: any) => <li className="pl-1">{children}</li>,
    a: ({ href, children }: any) => {
      const threadId = parseThreadDeepLink(href)
      if (threadId) {
        return <a href={href} onClick={(event) => { event.preventDefault(); useAgentStore.getState().switchThread(threadId) }} className="rounded bg-accent/[0.08] px-1.5 py-0.5 font-medium text-accent hover:bg-accent/[0.13]">{children}</a>
      }
      return <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:underline decoration-accent/50 underline-offset-2 font-medium">{children}</a>
    },
    strong: ({ children, ...props }: any) => <strong {...props}>{children}</strong>,
    em: ({ children, ...props }: any) => <em {...props}>{children}</em>,
    blockquote: ({ children }: any) => (
      <blockquote className="border-l-4 border-accent/30 pl-4 my-4 text-text-muted italic bg-surface/20 py-2 rounded-r">{children}</blockquote>
    ),
    h1: ({ children }: any) => <h1 className="text-2xl font-bold mb-4 mt-6 first:mt-0 text-text-primary tracking-tight">{children}</h1>,
    h2: ({ children }: any) => <h2 className="text-xl font-bold mb-3 mt-5 first:mt-0 text-text-primary tracking-tight">{children}</h2>,
    h3: ({ children }: any) => <h3 className="text-lg font-semibold mb-2 mt-4 first:mt-0 text-text-primary">{children}</h3>,
    table: ({ children }: any) => (
      <div className="overflow-x-auto my-4">
        <table className="min-w-full border-collapse border border-border">{children}</table>
      </div>
    ),
    thead: ({ children }: any) => <thead className="bg-surface/50">{children}</thead>,
    tbody: ({ children }: any) => <tbody>{children}</tbody>,
    tr: ({ children }: any) => <tr className="border-b border-border hover:bg-surface-hover transition-colors">{children}</tr>,
    th: ({ children }: any) => <th className="border border-border px-4 py-2 text-text-primary text-left font-semibold text-text-primary">{children}</th>,
    td: ({ children }: any) => <td className="border border-border px-4 py-2 text-text-secondary">{children}</td>,
  }), [fontSize, handleOpenFile])

  if (!contentWithoutAlert && !systemAlert) {
    return null
  }

  return (
    <>
      {systemAlert && (
        <SystemAlert
          type={systemAlert.type}
          title={systemAlert.title}
          message={systemAlert.message}
          suggestion={systemAlert.suggestion}
        />
      )}
      {contentWithoutAlert && (
        <div
          style={{ fontSize: `${fontSize}px` }}
          className="text-text-primary/90 leading-relaxed tracking-wide overflow-hidden"
        >
          {keepStreamingLayout && streamingPartition ? (
            <>
              {streamingPartition.completedBlocks.map((block, index) => (
                <StableStreamingMarkdownBlock
                  key={index}
                  content={block}
                  components={markdownComponents as any}
                />
              ))}
              {streamingPartition.activeBlock && (
                <div
                  key={`active-block-${streamingPartition.completedBlocks.length}`}
                  className={isStreaming ? 'streaming-block-soft-enter' : undefined}
                >
                  {streamingPartition.hasOpenFence || streamingPartition.activeBlock.length > 4096 ? (
                    <div className={`whitespace-pre-wrap break-words leading-7 ${streamingPartition.hasOpenFence ? 'font-mono' : ''}`}>
                      {streamingPartition.activeBlock}
                    </div>
                  ) : (
                    <StableStreamingMarkdownBlock
                      content={streamingPartition.activeBlock}
                      components={markdownComponents as any}
                    />
                  )}
                </div>
              )}
            </>
          ) : (
            <StableStreamingMarkdownBlock
              content={contentWithoutAlert}
              components={markdownComponents as any}
            />
          )}
        </div>
      )}
    </>
  )
})
MarkdownContent.displayName = 'MarkdownContent'

function getSourceHref(source: LLMStreamSource): string | null {
  return source.sourceType === 'url' && source.url ? source.url : null
}

function getSourceLabel(source: LLMStreamSource): string {
  return source.title || source.filename || source.url || source.id
}

const SourcesBlock = React.memo(({ sources }: { sources: LLMStreamSource[] }) => {
  if (sources.length === 0) return null

  return (
    <div className="my-3 rounded-xl border border-border/60 bg-surface/30 px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
        <Link2 className="h-3.5 w-3.5" />
        Sources
      </div>
      <div className="space-y-1.5">
        {sources.map((source) => {
          const href = getSourceHref(source)
          const label = getSourceLabel(source)
          const meta = source.sourceType === 'document'
            ? source.mediaType || source.filename
            : source.url

          return (
            <div
              key={source.id || `${source.sourceType}:${label}`}
              className="rounded-lg border border-border/50 bg-background/35 px-2.5 py-2"
            >
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-sm font-medium text-accent transition-colors hover:text-accent-hover hover:underline"
                >
                  {label}
                </a>
              ) : (
                <div className="text-sm font-medium text-text-primary">{label}</div>
              )}
              {meta && (
                <div className="mt-0.5 break-all text-[11px] text-text-muted">
                  {meta}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})

SourcesBlock.displayName = 'SourcesBlock'

/**
 * 系统提示卡（可能带车道恢复面板）。
 *
 * 顶层会话的车道没能自动合并时，提交只留在 `adnify/lane-*` 分支上，而聊天界面里没有
 * Plan 任务卡可以承载"重试合并 / 丢弃"。所以提示卡自己带上车道投影，就地长出面板 ——
 * 面板本体和 Plan 侧共用（components/git），状态语义因此不会两边打架。
 */
const SystemAlertWithLane = React.memo(({ part, messageId }: { part: SystemAlertPart, messageId?: string }) => {
  const language = useStore(s => s.language)
  const lane = part.lane
  return <>
    <SystemAlert
      type={part.alertType}
      title={part.title}
      message={part.message}
      suggestion={part.suggestion}
      compact={part.compact}
    />
    {lane?.branch && <WorktreeLanePanel
      lane={lane}
      workspacePath={part.laneWorkspacePath ?? null}
      language={language}
      onResolved={(status, diagnosis) => {
        if (!messageId) return
        useAgentStore.getState().resolveLaneAlert(messageId, lane.branch!, {
          ...lane, status,
          notice: diagnosis?.notice, error: diagnosis?.error, conflicts: diagnosis?.conflicts,
        })
      }}
    />}
  </>
})

SystemAlertWithLane.displayName = 'SystemAlertWithLane'

// 渲染单个 Part
const RenderPart = React.memo(({
  part,
  pendingToolId,
  onApproveTool,
  onApproveToolForTask,
  onRejectTool,
  onStopTool,
  onOpenDiff,
  fontSize,
  isStreaming,
  messageId,
}: RenderPartProps) => {
  if (isTextPart(part)) {
    const textStr = typeof part.content === 'string' ? part.content : String(part.content ?? '')
    if (!textStr.trim()) return null
    return (
      <MarkdownContent
        content={textStr}
        fontSize={fontSize}
        isStreaming={isStreaming}
      />
    )
  }

  if (isReasoningPart(part)) {
    if (!part.content?.trim() && !part.isStreaming) return null
    return (
      <ThinkingBlock
        content={part.content}
        startTime={part.startTime}
        isStreaming={!!part.isStreaming}
        fontSize={fontSize}
      />
    )
  }

  // Search results are static for now
  if (isSearchPart(part)) {
    return null
  }

  if (isSystemAlertPart(part)) {
    return <SystemAlertWithLane part={part} messageId={messageId} />
  }

  // Lint check results
  if (isLintCheckPart(part)) {
    return <LintCheckCard part={part} />
  }

  if (isContextSnapshotPart(part)) {
    return (
      <CompressionDigestCard
        part={part}
        variant={part.presentation === 'source_marker' ? 'timeline' : 'card'}
      />
    )
  }

  // Tool calls: 统一由 renderToolCallCard 处理
  if (isSourcesPart(part)) {
    return <SourcesBlock sources={part.sources} />
  }

  if (isToolCallPart(part)) {
    const tc = part.toolCall
    return (
      <div className="my-3">
        {renderToolCallCard(tc, {
          pendingToolId,
          onApproveTool,
          onApproveToolForTask,
          onRejectTool,
          onStopTool,
          onOpenDiff,
          messageId,
        })}
      </div>
    )
  }

  return null
})

RenderPart.displayName = 'RenderPart'

// 助手消息内容组件 - 将分组逻辑提取出来并 memoize
const AssistantMessageContent = React.memo(({
  parts,
  pendingToolId,
  onApproveTool,
  onApproveToolForTask,
  onRejectTool,
  onStopTool,
  onOpenDiff,
  fontSize,
  isStreaming,
  messageId,
}: {
  parts: AssistantPart[]
  pendingToolId?: string
  onApproveTool?: () => void
  onApproveToolForTask?: () => void
  onRejectTool?: () => void
  onStopTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
  fontSize: number
  isStreaming?: boolean
  messageId: string
}) => {
  // Memoize 分组逻辑
  const groups = React.useMemo(() => {
    const result: Array<
      | { type: 'part'; part: AssistantPart; index: number; key: string }
      | { type: 'tool_group'; toolCalls: ToolCall[]; startIndex: number; key: string }
    > = []
    const stablePartKeys = buildChatMessagePartKeys(parts)

    let currentToolCalls: ToolCall[] = []
    let startIndex = -1

    parts.forEach((part, index) => {
      if (isToolCallPart(part)) {
        if (currentToolCalls.length === 0) startIndex = index
        currentToolCalls.push(part.toolCall)
      } else {
        if (currentToolCalls.length > 0) {
          result.push({
            type: 'tool_group',
            toolCalls: currentToolCalls,
            startIndex,
            key: `tools:${currentToolCalls.map(toolCall => toolCall.id).join(':')}`,
          })
          currentToolCalls = []
        }
        result.push({ type: 'part', part, index, key: stablePartKeys[index] })
      }
    })

    if (currentToolCalls.length > 0) {
      result.push({
        type: 'tool_group',
        toolCalls: currentToolCalls,
        startIndex,
        key: `tools:${currentToolCalls.map(toolCall => toolCall.id).join(':')}`,
      })
    }

    return result
  }, [parts])

  return (
    <>
      {groups.map((group) => {
        if (group.type === 'part') {
          return (
            <div key={group.key} className="w-full">
              <RenderPart
                part={group.part}
                index={group.index}
                pendingToolId={pendingToolId}
                onApproveTool={onApproveTool}
                onApproveToolForTask={onApproveToolForTask}
                onRejectTool={onRejectTool}
                onStopTool={onStopTool}
                onOpenDiff={onOpenDiff}
                fontSize={fontSize}
                isStreaming={isStreaming}
                messageId={messageId}
              />
            </div>
          )
        }

        if (group.toolCalls.length === 1) {
          return (
            <div key={group.key} className="w-full">
              <RenderPart
                part={parts[group.startIndex]}
                index={group.startIndex}
                pendingToolId={pendingToolId}
                onApproveTool={onApproveTool}
                onApproveToolForTask={onApproveToolForTask}
                onRejectTool={onRejectTool}
                onStopTool={onStopTool}
                onOpenDiff={onOpenDiff}
                fontSize={fontSize}
                isStreaming={isStreaming}
                messageId={messageId}
              />
            </div>
          )
        }

        return (
          <div key={group.key} className="w-full">
            <ToolCallGroup
              toolCalls={group.toolCalls}
              pendingToolId={pendingToolId}
              onApproveTool={onApproveTool}
              onApproveToolForTask={onApproveToolForTask}
              onRejectTool={onRejectTool}
              onStopTool={onStopTool}
              onOpenDiff={onOpenDiff}
              messageId={messageId}
            />
          </div>
        )
      })}
    </>
  )
})
AssistantMessageContent.displayName = 'AssistantMessageContent'

const ChatMessage = React.memo(({
  message: messageProp,
  onEdit,
  onRegenerate,
  onRestore,
  onApproveTool,
  onApproveToolForTask,
  onRejectTool,
  onStopTool,
  onOpenDiff,
  pendingToolId,
  hasCheckpoint,
  isAwaitingApproval = false,
}: ChatMessageProps) => {
  const message = messageProp

  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [copied, setCopied] = useState(false)
  const [previewImageIndex, setPreviewImageIndex] = useState<number | null>(null)
  const { editorConfig, language, expandAgentBlocksByDefault, userAvatarStyle, userAvatarSeed, userDisplayName, setShowAvatarDialog } = useStore(useShallow(s => ({
    editorConfig: s.editorConfig,
    language: s.language,
    expandAgentBlocksByDefault: s.agentConfig.expandAgentBlocksByDefault ?? false,
    userAvatarStyle: s.userAvatarStyle,
    userAvatarSeed: s.userAvatarSeed,
    userDisplayName: s.userDisplayName,
    setShowAvatarDialog: s.setShowAvatarDialog,
  })))
  const fontSize = editorConfig.chatFontSize ?? editorConfig.fontSize

  if (!isUserMessage(message) && !isAssistantMessage(message)) {
    return null
  }

  const isUser = isUserMessage(message)
  const textContent = getMessageText(message.content)
  const images = isUser ? getMessageImages(message.content) : []

  const handleStartEdit = () => {
    setEditContent(textContent)
    setIsEditing(true)
  }

  const handleSaveEdit = () => {
    if (onEdit && editContent.trim()) {
      onEdit(message.id, editContent.trim())
    }
    setIsEditing(false)
  }

  const handleCopy = async () => {
    const success = await writeClipboardText(textContent)
    if (!success) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const tt = {
    copy: t('chatMessage.copyContent', language),
    edit: t('chatMessage.editMessage', language),
    restore: t('chatMessage.restoreCheckpoint', language),
    save: t('saveAndResend', language),
    cancel: t('cancel', language),
  }

  const [typingIndex, setTypingIndex] = useState(0)
  // selector 提到了 chatMessageLiveSelector.ts —— 它有引用稳定性要求需要被测试
  // 覆盖（静态消息必须返回恒等引用，否则 overscan 内的每条消息都会跟着流式重渲染）
  const { isStreaming, liveParts, liveInteractive } = useAgentStore(
    useShallow(state =>
      selectLiveState(
        state as unknown as LiveSelectorState,
        message.id,
        isAssistantMessage(message),
        Boolean(isAssistantMessage(message) && message.isStreaming),
      ),
    ),
  )

  const assistantParts = isAssistantMessage(message) ? (liveParts ?? message.parts) : undefined
  const assistantInteractive = isAssistantMessage(message) ? (liveInteractive ?? message.interactive) : undefined

  useEffect(() => {
    if (isStreaming) {
      const interval = setInterval(() => {
        setTypingIndex(prev => (prev + 1) % 8)
      }, 5000)
      return () => clearInterval(interval)
    }
  }, [isStreaming])

  const hasMetaGroup = React.useMemo(() => {
    if (!isAssistantMessage(message)) return false

    return Boolean(
      message.contextItems?.some((item: any) => item.type === 'Skill') ||
      assistantParts?.some(isSearchPart)
    )
  }, [assistantParts, message])

  const assistantProjection = React.useMemo(() => {
    if (!isAssistantMessage(message) || !assistantParts) {
      return null
    }

    const messageHasPendingApproval = isAwaitingApproval
      && !!pendingToolId
      && (message.toolCalls?.some(toolCall => toolCall.id === pendingToolId) ?? false)

    return projectAssistantTurn(assistantParts, {
      isStreaming,
      isAwaitingApproval: messageHasPendingApproval,
      expandProcessByDefault: expandAgentBlocksByDefault,
      hasContextMeta: hasMetaGroup,
    })
  }, [assistantParts, expandAgentBlocksByDefault, hasMetaGroup, isAwaitingApproval, isStreaming, message, pendingToolId])

  const shouldCollapseProcess = assistantProjection?.shouldCollapseProcess ?? false
  const shouldRenderMetaGroup = isAssistantMessage(message) && !shouldCollapseProcess && hasMetaGroup
  const alertAssistantParts = assistantProjection?.alertParts ?? []
  const visibleAssistantParts = shouldCollapseProcess
    ? (assistantProjection?.finalReplyParts ?? [])
    : (assistantParts ?? []).filter(part => !isSystemAlertPart(part))
  const processAssistantParts = assistantProjection?.processParts ?? []

  return (
    <div className={`
      w-full group/msg transition-colors duration-300
      ${isUser ? 'py-1 bg-transparent' : 'py-2 bg-transparent'}
    `}>
      <div className="w-full px-4 flex flex-col gap-1">

        {/* User Layout */}
        {isUser && (
          <div className="w-full flex items-start justify-end gap-3">
            {/* Left Content Area (Name + Bubble + Actions) */}
            <div className="flex flex-col items-end gap-1.5 min-w-0 max-w-[85%] sm:max-w-[75%]">
              {/* User Name */}
              <span className="text-[13px] font-bold tracking-tight text-text-primary select-none pr-1">
                {userDisplayName}
              </span>

              {/* Bubble / Editing */}
              <div className="w-full flex flex-col items-end min-w-0">
                {isEditing ? (
                  <div className="w-full relative group/edit">
                    <div className="absolute inset-0 -m-1 rounded-[20px] bg-accent/5 opacity-0 group-focus-within/edit:opacity-100 transition-opacity duration-300 pointer-events-none" />
                    <div className="relative bg-surface/80 backdrop-blur-xl border border-accent/30 rounded-[18px] shadow-lg overflow-hidden animate-scale-in origin-right transition-all duration-200 group-focus-within/edit:border-accent group-focus-within/edit:ring-1 group-focus-within/edit:ring-accent/50">
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            handleSaveEdit()
                          }
                          if (e.key === 'Escape') {
                            setIsEditing(false)
                          }
                        }}
                        className="w-full bg-transparent border-none outline-none px-4 py-3 text-text-primary resize-none focus:ring-0 focus:outline-none transition-all custom-scrollbar font-mono text-sm leading-relaxed placeholder:text-text-muted/30"
                        rows={Math.max(2, Math.min(15, editContent.split('\n').length))}
                        autoFocus
                        style={{ fontSize: `${fontSize}px` }}
                        placeholder="Type your message..."
                      />
                      <div className="flex items-center justify-between px-2 py-1.5 bg-black/5 border-t border-black/5">
                        <span className="text-[10px] text-text-muted/50 ml-2 font-medium">
                          Esc to cancel • Enter to save
                        </span>
                        <div className="flex gap-1">
                          <button
                            onClick={() => setIsEditing(false)}
                            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-black/10 transition-colors"
                            title={tt.cancel}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={handleSaveEdit}
                            className="p-1.5 rounded-lg text-accent hover:text-white hover:bg-accent transition-all shadow-sm"
                            title={tt.save}
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="relative bg-surface/75 backdrop-blur-md text-text-primary/95 px-4 py-3 rounded-[20px] rounded-tr-[4px] shadow-[0_4px_16px_rgba(0,0,0,0.02),_0_2px_4px_rgba(0,0,0,0.01)] w-fit max-w-full border border-border/60">
                    {/* Context Items */}
                    {message.contextItems && message.contextItems.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2 -mt-1 pt-1 justify-end">
                        {message.contextItems.map((item: any, i: number) => {
                          const getContextStyle = (type: string) => {
                            switch (type) {
                              case 'File': return { bg: 'bg-text-primary/[0.04]', text: 'text-text-secondary', border: 'border-transparent', Icon: FileText }
                              case 'CodeSelection': return { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-transparent', Icon: Code }
                              case 'Folder': return { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-transparent', Icon: Folder }
                              case 'Skill': return { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20', Icon: Wrench }
                              case 'ShellServer': return { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', Icon: Server }
                              default: return { bg: 'bg-text-primary/[0.04]', text: 'text-text-muted', border: 'border-transparent', Icon: FileText }
                            }
                          }
                          const style = getContextStyle(item.type)
                          const label = (() => {
                            switch (item.type) {
                              case 'File':
                              case 'Folder': {
                                const uri = item.uri || ''
                                return getFileName(uri) || uri
                              }
                              case 'CodeSelection': {
                                const uri = item.uri || ''
                                const range = item.range as [number, number] | undefined
                                const name = getFileName(uri) || uri
                                return range ? `${name}:${range[0]}-${range[1]}` : name
                              }
                              case 'Skill': {
                                return `@${item.skillId || 'skill'}`
                              }
                              case 'ShellServer': {
                                return `#${item.serverName || 'server'}#`
                              }
                              default: return 'Context'
                            }
                          })()
                          const IconComponent = style.Icon

                          return (
                            <span key={i} className={`inline-flex items-center gap-1 px-1.5 py-0.5 ${style.bg} ${style.text} text-[10px] font-medium rounded-md border ${style.border} select-none opacity-80 hover:opacity-100 transition-opacity`}>
                              <IconComponent className="w-3 h-3 opacity-70" />
                              <span className="max-w-[150px] truncate">{label}</span>
                            </span>
                          )
                        })}
                      </div>
                    )}

                    {/* Images */}
                    {images.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2 justify-end">
                        {images.map((img, i) => {
                          const imgSrc = `data:${img.source.media_type};base64,${img.source.data}`
                          return (
                            <div
                              key={`img-${img.source.media_type}-${i}`}
                              onClick={() => setPreviewImageIndex(i)}
                              className="rounded-lg overflow-hidden border border-text-inverted/10 shadow-md h-28 max-w-[200px] group/img relative cursor-zoom-in hover:opacity-90 transition-opacity"
                            >
                              <LazyImage
                                src={imgSrc}
                                alt="Upload"
                                className="h-full w-auto object-cover"
                              />
                            </div>
                          )
                        })}
                      </div>
                    )}

                    <ImageLightbox
                      isOpen={previewImageIndex !== null}
                      images={images.map((img) => ({
                        src: `data:${img.source.media_type};base64,${img.source.data}`,
                        alt: 'Preview',
                      }))}
                      initialIndex={previewImageIndex ?? 0}
                      alt="Preview"
                      onClose={() => setPreviewImageIndex(null)}
                    />

                    <div
                      className="text-[14px] leading-relaxed whitespace-pre-wrap break-words font-sans"
                      style={{ fontSize: `${fontSize}px` }}
                    >
                      {textContent}
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              {!isEditing && (
                <div className="flex items-center gap-0.5 mt-1 mr-1 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-200">
                  <Tooltip content={tt.copy}>
                    <button onClick={handleCopy} className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all">
                      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </Tooltip>
                  {onEdit && (
                    <Tooltip content={tt.edit}>
                      <button onClick={handleStartEdit} className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all">
                        <Edit2 className="w-3 h-3" />
                      </button>
                    </Tooltip>
                  )}
                  {hasCheckpoint && onRestore && (
                    <Tooltip content={tt.restore}>
                      <button onClick={() => onRestore(message.id)} className="p-1 rounded-md text-text-muted hover:text-amber-400 hover:bg-surface-hover transition-all">
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    </Tooltip>
                  )}
                </div>
              )}
            </div>

            {/* Right Avatar Area */}
            <Tooltip content={t('chatMessage.clickToCustomizeMy', language)}>
              <div
                onClick={() => setShowAvatarDialog(true)}
                className="w-9 h-9 rounded-xl overflow-hidden border border-border shadow-[0_4px_12px_-2px_rgba(0,0,0,0.1)] bg-surface/50 backdrop-blur-md relative flex-shrink-0 cursor-pointer hover:scale-105 active:scale-95 hover:border-accent/50 transition-all duration-200 group/avatar mt-0.5"
              >
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity duration-200 z-10">
                  <Edit2 className="w-3.5 h-3.5 text-white" />
                </div>
                <div className="absolute inset-0 bg-accent/5 pointer-events-none" />
                <img
                  src={`https://api.dicebear.com/7.x/${userAvatarStyle}/svg?seed=${encodeURIComponent(userAvatarSeed)}`}
                  alt="User Avatar"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              </div>
            </Tooltip>
          </div>
        )}

        {/* Assistant Layout */}
        {!isUser && (
          <div className="w-full min-w-0 flex flex-col gap-2">
            <div className="flex items-center gap-3 px-1">
              <div className="w-9 h-9 rounded-xl overflow-hidden border border-border shadow-[0_4px_12px_-2px_rgba(0,0,0,0.1)] bg-surface/50 backdrop-blur-md relative flex-shrink-0">
                <div className="absolute inset-0 bg-accent/5 pointer-events-none" />
                <OtterAsset asset={isStreaming ? 'typing' : 'assistantFace'} alt="AI" className="h-full w-full object-cover" />
              </div>
              <div className="flex items-center gap-2 select-none overflow-hidden pr-2">
                <span className="text-[13px] font-bold tracking-tight text-text-primary">Adnify</span>

                {isStreaming && (
                  <div className="flex items-center gap-1.5 ml-1 px-2 py-0.5 rounded-full bg-surface-hover/50 border border-transparent self-center mt-[1px]">
                    <div className="relative flex h-[5px] w-[5px] items-center justify-center shrink-0">
                      <span className="animate-ping absolute inline-flex h-[8px] w-[8px] rounded-full bg-accent/40 opacity-75" style={{ animationDuration: '2s' }} />
                      <span className="relative inline-flex rounded-full h-[5px] w-[5px] bg-accent" />
                    </div>
                    <div className="relative flex items-center overflow-hidden h-[16px]">
                      <AnimatePresence mode="wait">
                        <motion.span
                          key={typingIndex}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          transition={{ duration: 0.25, ease: "easeOut" }}
                          className="text-[10px] text-text-muted/80 font-medium whitespace-nowrap tracking-wide"
                        >
                          {t(`agent.typing.${typingIndex}` as any, language)}
                        </motion.span>
                      </AnimatePresence>
                    </div>
                  </div>
                )}
              </div>

              {!isStreaming && (
                <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                  <Tooltip content={tt.copy}>
                    <button onClick={handleCopy} className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all">
                      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </Tooltip>
                  {onRegenerate && (
                    <div className="flex items-center">
                      <MessageBranchActions messageId={message.id} language={language} onRegenerate={onRegenerate} />
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="w-full text-[15px] leading-relaxed text-text-primary/90 pl-1">
              {/* System Context Widget at the top of the content */}
              {shouldRenderMetaGroup && (
                <MessageMetaGroup
                  autoSkills={message.contextItems?.filter((item: any) => item.type === 'Skill' && item.auto)}
                  manualSkills={message.contextItems?.filter((item: any) => item.type === 'Skill' && !item.auto)}
                  searchContent={assistantParts?.find(isSearchPart)?.content || undefined}
                  isSearchStreaming={(assistantParts?.find(isSearchPart) as any)?.isStreaming}
                />
              )}
              <div className="prose-custom w-full max-w-none">
                {shouldCollapseProcess && assistantProjection?.hasProcessContent && (
                  <ProcessFold key="process" language={language} summary={assistantProjection.summary}>
                    {hasMetaGroup && (
                      <MessageMetaGroup
                        autoSkills={message.contextItems?.filter((item: any) => item.type === 'Skill' && item.auto)}
                        manualSkills={message.contextItems?.filter((item: any) => item.type === 'Skill' && !item.auto)}
                        searchContent={assistantParts?.find(isSearchPart)?.content || undefined}
                        isSearchStreaming={(assistantParts?.find(isSearchPart) as any)?.isStreaming}
                      />
                    )}
                    {processAssistantParts.length > 0 && (
                      <AssistantMessageContent
                        parts={processAssistantParts}
                        pendingToolId={pendingToolId}
                        onApproveTool={onApproveTool}
                        onApproveToolForTask={onApproveToolForTask}
                        onRejectTool={onRejectTool}
                        onStopTool={onStopTool}
                        onOpenDiff={onOpenDiff}
                        fontSize={fontSize}
                        isStreaming={isStreaming}
                        messageId={message.id}
                      />
                    )}
                  </ProcessFold>
                )}
                {alertAssistantParts.length > 0 && (
                  <AssistantMessageContent
                    key="alerts"
                    parts={alertAssistantParts}
                    pendingToolId={pendingToolId}
                    onApproveTool={onApproveTool}
                    onApproveToolForTask={onApproveToolForTask}
                    onRejectTool={onRejectTool}
                    onStopTool={onStopTool}
                    onOpenDiff={onOpenDiff}
                    fontSize={fontSize}
                    isStreaming={isStreaming}
                    messageId={message.id}
                  />
                )}
                {visibleAssistantParts.length > 0 && (
                  <AssistantMessageContent
                    key="visible"
                    parts={visibleAssistantParts}
                    pendingToolId={pendingToolId}
                    onApproveTool={onApproveTool}
                    onApproveToolForTask={onApproveToolForTask}
                    onRejectTool={onRejectTool}
                    onStopTool={onStopTool}
                    onOpenDiff={onOpenDiff}
                    fontSize={fontSize}
                    isStreaming={isStreaming}
                    messageId={message.id}
                  />
                )}
              </div>

              {assistantInteractive && !isStreaming && (
                <div className="mt-2 w-full">
                  <InteractiveCard
                    content={assistantInteractive}
                    onSelect={(selectedIds, customText) => {
                      const response = buildInteractiveResponse(assistantInteractive, { selectedIds, customText })
                      window.dispatchEvent(new CustomEvent('chat-update-interactive', { detail: { messageId: message.id, selectedIds, customText } }))
                      window.dispatchEvent(new CustomEvent('chat-send-message', { detail: { content: response, messageId: message.id } }))
                    }}
                    disabled={Boolean(assistantInteractive.answeredAt || assistantInteractive.selectedIds?.length)}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
})



ChatMessage.displayName = 'ChatMessage'

export default ChatMessage
