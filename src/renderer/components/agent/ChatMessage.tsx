/**
 * 聊天消息组件
 * Linear / Apple 风格：完全左对齐，用户消息右对齐气泡
 * 新设计：极致排版，支持 Tooltip
 */

import React, { useState, useCallback, useEffect } from 'react'
import { User, Copy, Check, Edit2, RotateCcw, ChevronDown, X, Wrench, FileText, Code, Folder, Link2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { SyntaxHighlighter } from '@renderer/utils/syntaxHighlighter'
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { themeManager } from '../../config/themeConfig'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChatMessage as ChatMessageType,
  isUserMessage,
  isAssistantMessage,
  getMessageText,
  getMessageImages,
  AssistantPart,
  isTextPart,
  isToolCallPart,
  isReasoningPart,
  isSearchPart,
  isSystemAlertPart,
  isLintCheckPart,
  isContextSnapshotPart,
  isSourcesPart,
  ToolCall,
} from '@renderer/agent/types'
import type { LLMStreamSource } from '@/shared/types/llm'
import { LintCheckCard } from './LintCheckCard'
import ToolCallGroup, { renderToolCallCard } from './ToolCallGroup'
import { InteractiveCard } from './InteractiveCard'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { MessageBranchActions } from './BranchControls'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Tooltip } from '../ui/Tooltip'
import { Modal } from '../ui/Modal'
import { LazyImage } from '../common/LazyImage'
import { useSmoothStream } from '@renderer/hooks/useSmoothStream'
import { SystemAlert, parseSystemAlert } from './SystemAlert'
import { CompressionDigestCard } from './CompressionDigestCard'
import { t } from '../../i18n'
import { api } from '@/renderer/services/electronAPI'
import { toFullPath, getFileName } from '@shared/utils/pathUtils'
import { stripToolCallLeaks } from '@renderer/agent/utils/toolCallLeakFilter'
import type { ToolStreamingPreview } from '@shared/types'
import { publicAsset } from '@utils/publicAsset'

interface ChatMessageProps {
  message: ChatMessageType
  onEdit?: (messageId: string, newContent: string) => void
  onRegenerate?: (messageId: string) => void
  onRestore?: (messageId: string) => void
  onApproveTool?: () => void
  onRejectTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
  onSelectOption?: (messageId: string, selectedIds: string[]) => void
  pendingToolId?: string
  hasCheckpoint?: boolean
}

interface RenderPartProps {
  part: AssistantPart
  index: number
  pendingToolId?: string
  onApproveTool?: () => void
  onRejectTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
  fontSize: number
  isStreaming?: boolean
  messageId: string
}

const EMPTY_PREVIEWS: Record<string, ToolStreamingPreview> = {}
const MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkMath]
const MARKDOWN_REHYPE_PLUGINS = [rehypeKatex]
const ACTIVE_STREAM_PHASES = new Set(['streaming', 'tool_running', 'tool_pending'])
const STREAMING_TAIL_LENGTH = 40

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

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(codeText)
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

const cleanStreamingContent = (text: string): string => {
  if (!text) return ''
  return stripToolCallLeaks(text)
}

const renderStreamingTailText = (value: string, key: string) => {
  if (!value) return value

  const tailLength = Math.min(STREAMING_TAIL_LENGTH, value.length)
  if (tailLength <= 0) return value

  const stableText = value.slice(0, -tailLength)
  const animatedTail = value.slice(-tailLength)

  return (
    <React.Fragment key={key}>
      {stableText}
      {animatedTail.split('').map((char, i) => {
        const charIndex = value.length - tailLength + i
        return (
          <span key={`${key}-${charIndex}`} className="inline-stream-char">
            {char}
          </span>
        )
      })}
    </React.Fragment>
  )
}

const decorateStreamingChild = (child: React.ReactNode, path: string): { changed: boolean; node: React.ReactNode } => {
  if (typeof child === 'string') {
    return { changed: true, node: renderStreamingTailText(child, path) }
  }

  if (typeof child === 'number') {
    return { changed: true, node: renderStreamingTailText(String(child), path) }
  }

  if (!React.isValidElement(child)) {
    return { changed: false, node: child }
  }

  const childProps = child.props as { children?: React.ReactNode } | null
  if (!childProps || childProps.children == null) {
    return { changed: false, node: child }
  }

  const decoratedChildren = decorateStreamingChildren(childProps.children, path)
  if (decoratedChildren === childProps.children) {
    return { changed: false, node: child }
  }

  return {
    changed: true,
    node: React.cloneElement(child, undefined, decoratedChildren),
  }
}

const decorateStreamingChildren = (children: React.ReactNode, basePath = 'tail'): React.ReactNode => {
  const childArray = React.Children.toArray(children)
  for (let index = childArray.length - 1; index >= 0; index -= 1) {
    const currentChild = childArray[index]
    const decorated = decorateStreamingChild(currentChild, `${basePath}-${index}`)
    if (!decorated.changed) continue
    if (decorated.node == null || typeof decorated.node === 'boolean') continue

    const nextChildren = [...childArray]
    nextChildren[index] = decorated.node
    return nextChildren
  }

  return children
}


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
  const [isExpanded, setIsExpanded] = useState(true)
  const { openFile, setActiveFile, workspacePath } = useStore(useShallow(s => ({ openFile: s.openFile, setActiveFile: s.setActiveFile, workspacePath: s.workspacePath })))

  const hasAutoSkills = autoSkills && autoSkills.length > 0
  const hasManualSkills = manualSkills && manualSkills.length > 0
  const hasSearch = searchContent !== undefined || isSearchStreaming
  const hasSkills = hasAutoSkills || hasManualSkills
  const isStreaming = isSearchStreaming

  if (!hasSkills && !hasSearch) return null

  const handleOpenSkill = async (e: React.MouseEvent, skillId: string) => {
    e.stopPropagation()
    if (!workspacePath) return
    const filePath = `${workspacePath}/.adnify/skills/${skillId}/SKILL.md`.replace(/\//g, '\\')
    const content = await api.file.read(filePath)
    if (content !== null) {
      openFile(filePath, content)
      setActiveFile(filePath)
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
        className="flex w-full items-center gap-2 py-1.5 cursor-pointer select-none group rounded-md hover:bg-text-primary/[0.03] transition-colors"
      >
        <motion.div animate={{ rotate: isExpanded ? 0 : -90 }} transition={{ duration: 0.15 }} className="shrink-0 text-text-muted/40 group-hover:text-text-muted transition-colors">
          <ChevronDown className="w-3.5 h-3.5" />
        </motion.div>

        <div className="shrink-0 w-4 h-4 flex items-center justify-center">
          {isStreaming ? (
            <div className="w-3.5 h-3.5 rounded-full bg-accent/20 flex items-center justify-center border border-accent/30">
              <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            </div>
          ) : (
            <Wrench className="w-3 h-3 text-text-muted/50" />
          )}
        </div>

        <span className={`text-[12px] ${isStreaming ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary transition-colors'}`}>
          Context
        </span>

        {/* 折叠时显示 skill 名称列表 */}
        {!isExpanded && skillNames && (
          <span className="text-[11px] text-text-muted/40 truncate ml-0.5">
            — {skillNames}
          </span>
        )}
      </div>

      {/* 展开内容 — 每行一个类别摘要 */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="pb-1.5 pl-[38px] pr-3 space-y-0.5">
              {/* Skill Referenced */}
              {hasSkills && (
                <div className="flex items-center gap-1.5 text-[11px]">
                  <span className="text-text-muted/35 shrink-0">Skill Referenced</span>
                  {allSkills.map((item: any, i: number) => (
                    <React.Fragment key={item.skillId || i}>
                      {i > 0 && <span className="text-text-muted/20">,</span>}
                      <button
                        onClick={(e) => handleOpenSkill(e, item.skillId)}
                        className="font-mono text-text-muted/55 hover:text-accent transition-colors focus:outline-none"
                      >
                        {item.skillId}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              )}

              {/* File Referenced */}
              {hasSearch && (
                <div className="text-[11px]">
                  {searchContent ? (
                    <div className="flex items-start gap-1.5">
                      <span className="text-text-muted/35 shrink-0">File Referenced</span>
                      <div className="text-text-muted/40 leading-relaxed max-h-32 overflow-auto custom-scrollbar whitespace-pre-wrap">
                        {searchContent}
                      </div>
                    </div>
                  ) : (
                    <span className="text-text-muted/25 italic">Searching files...</span>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})
MessageMetaGroup.displayName = 'MessageMetaGroup'

const ThinkingBlock = React.memo(({ content, startTime, isStreaming, fontSize }: ThinkingBlockProps) => {
  const [isExpanded, setIsExpanded] = useState(true)
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

  // Fluid effect for thinking content, ONLY when streaming
  const fluidContent = useSmoothStream(content, isStreaming, 1.5)

  // 流式输出时自动滚动到底部
  useEffect(() => {
    if (isStreaming && isExpanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [fluidContent, isStreaming, isExpanded])

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
                {isStreaming ? renderStreamingTailText(fluidContent, 'think-tail') : fluidContent}
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

  // 所有 useMemo 必须在前面
  const cleanedContent = React.useMemo(() => {
    return isStreaming ? cleanStreamingContent(content) : content
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

  // 平滑流式插入
  const smoothContent = useSmoothStream(contentWithoutAlert || '', !!isStreaming, 1.5)
  const enableBlockReveal = !!isStreaming

  const { workspacePath, openFile, setActiveFile } = useStore(useShallow(s => ({ workspacePath: s.workspacePath, openFile: s.openFile, setActiveFile: s.setActiveFile })))

  const handleOpenFile = React.useCallback(async (filePath: string) => {
    if (!workspacePath) return
    const resolvedPath = toFullPath(filePath, workspacePath)

    try {
      const content = await api.file.read(resolvedPath)
      if (content !== null) {
        openFile(resolvedPath, content)
        setActiveFile(resolvedPath)
      }
    } catch (err) {
      console.warn('Failed to open file from markdown:', err)
    }
  }, [workspacePath, openFile, setActiveFile])

  const renderStreamingChildren = React.useCallback((children: React.ReactNode) => {
    if (!isStreaming) return children
    return decorateStreamingChildren(children)
  }, [isStreaming])

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
    pre: ({ children }: any) => <div className={`overflow-x-auto max-w-full ${enableBlockReveal ? 'animate-block-reveal' : ''}`}>{children}</div>,
    p: ({ children }: any) => <p className={`mb-3 last:mb-0 leading-7 break-words ${enableBlockReveal ? 'animate-block-reveal' : ''}`}>{renderStreamingChildren(children)}</p>,
    ul: ({ children }: any) => <ul className={`list-disc pl-5 mb-3 space-y-1 ${enableBlockReveal ? 'animate-block-reveal' : ''}`}>{children}</ul>,
    ol: ({ children }: any) => <ol className={`list-decimal pl-5 mb-3 space-y-1 ${enableBlockReveal ? 'animate-block-reveal' : ''}`}>{children}</ol>,
    li: ({ children }: any) => <li className={`pl-1 ${enableBlockReveal ? 'animate-block-reveal' : ''}`}>{renderStreamingChildren(children)}</li>,
    a: ({ href, children }: any) => (
      <a href={href} target="_blank" className="text-accent hover:underline decoration-accent/50 underline-offset-2 font-medium">{renderStreamingChildren(children)}</a>
    ),
    strong: ({ children, ...props }: any) => <strong {...props}>{renderStreamingChildren(children)}</strong>,
    em: ({ children, ...props }: any) => <em {...props}>{renderStreamingChildren(children)}</em>,
    blockquote: ({ children }: any) => (
      <blockquote className={`border-l-4 border-accent/30 pl-4 my-4 text-text-muted italic bg-surface/20 py-2 rounded-r ${enableBlockReveal ? 'animate-block-reveal' : ''}`}>{renderStreamingChildren(children)}</blockquote>
    ),
    h1: ({ children }: any) => <h1 className={`text-2xl font-bold mb-4 mt-6 first:mt-0 text-text-primary tracking-tight ${enableBlockReveal ? 'animate-block-reveal' : ''}`}>{renderStreamingChildren(children)}</h1>,
    h2: ({ children }: any) => <h2 className={`text-xl font-bold mb-3 mt-5 first:mt-0 text-text-primary tracking-tight ${enableBlockReveal ? 'animate-block-reveal' : ''}`}>{renderStreamingChildren(children)}</h2>,
    h3: ({ children }: any) => <h3 className={`text-lg font-semibold mb-2 mt-4 first:mt-0 text-text-primary ${enableBlockReveal ? 'animate-block-reveal' : ''}`}>{renderStreamingChildren(children)}</h3>,
    table: ({ children }: any) => (
      <div className={`overflow-x-auto my-4 ${enableBlockReveal ? 'animate-block-reveal' : ''}`}>
        <table className="min-w-full border-collapse border border-border">{children}</table>
      </div>
    ),
    thead: ({ children }: any) => <thead className="bg-surface/50">{children}</thead>,
    tbody: ({ children }: any) => <tbody>{children}</tbody>,
    tr: ({ children }: any) => <tr className="border-b border-border hover:bg-surface-hover transition-colors">{children}</tr>,
    th: ({ children }: any) => <th className="border border-border px-4 py-2 text-text-primary text-left font-semibold text-text-primary">{renderStreamingChildren(children)}</th>,
    td: ({ children }: any) => <td className="border border-border px-4 py-2 text-text-secondary">{renderStreamingChildren(children)}</td>,
  }), [enableBlockReveal, fontSize, handleOpenFile, isStreaming, renderStreamingChildren])

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
          className={`text-text-primary/90 leading-relaxed tracking-wide overflow-hidden ${isStreaming ? 'streaming-ink-effect' : ''}`}
        >
          <ReactMarkdown
            className="prose prose-invert max-w-none"
            remarkPlugins={MARKDOWN_REMARK_PLUGINS}
            rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
            components={markdownComponents}
            skipHtml
          >
            {smoothContent}
          </ReactMarkdown>
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

// 渲染单个 Part
const RenderPart = React.memo(({
  part,
  index,
  pendingToolId,
  onApproveTool,
  onRejectTool,
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
        key={`text-${index}`}
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
        key={`reasoning-${index}`}
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
    return (
      <SystemAlert
        type={part.alertType}
        title={part.title}
        message={part.message}
        suggestion={part.suggestion}
        compact={part.compact}
      />
    )
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
      <div className={`my-3 ${isStreaming ? 'animate-fade-in' : ''}`}>
        {renderToolCallCard(tc, {
          pendingToolId,
          onApproveTool,
          onRejectTool,
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
  onRejectTool,
  onOpenDiff,
  fontSize,
  isStreaming,
  messageId,
}: {
  parts: AssistantPart[]
  pendingToolId?: string
  onApproveTool?: () => void
  onRejectTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
  fontSize: number
  isStreaming?: boolean
  messageId: string
}) => {
  // Memoize 分组逻辑
  const groups = React.useMemo(() => {
    const result: Array<
      | { type: 'part'; part: AssistantPart; index: number }
      | { type: 'tool_group'; toolCalls: ToolCall[]; startIndex: number }
    > = []

    let currentToolCalls: ToolCall[] = []
    let startIndex = -1

    parts.forEach((part, index) => {
      if (isToolCallPart(part)) {
        if (currentToolCalls.length === 0) startIndex = index
        currentToolCalls.push(part.toolCall)
      } else {
        if (currentToolCalls.length > 0) {
          result.push({ type: 'tool_group', toolCalls: currentToolCalls, startIndex })
          currentToolCalls = []
        }
        result.push({ type: 'part', part, index })
      }
    })

    if (currentToolCalls.length > 0) {
      result.push({ type: 'tool_group', toolCalls: currentToolCalls, startIndex })
    }

    return result
  }, [parts])

  return (
    <>
      {groups.map((group) => {
        if (group.type === 'part') {
          return (
            <div key={`wrap-part-${group.index}`} className="w-full">
              <RenderPart
                part={group.part}
                index={group.index}
                pendingToolId={pendingToolId}
                onApproveTool={onApproveTool}
                onRejectTool={onRejectTool}
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
            <div key={`wrap-tool-${group.startIndex}`} className="w-full">
              <RenderPart
                part={parts[group.startIndex]}
                index={group.startIndex}
                pendingToolId={pendingToolId}
                onApproveTool={onApproveTool}
                onRejectTool={onRejectTool}
                onOpenDiff={onOpenDiff}
                fontSize={fontSize}
                isStreaming={isStreaming}
                messageId={messageId}
              />
            </div>
          )
        }

        return (
          <div key={`wrap-group-${group.startIndex}`} className="w-full">
            <ToolCallGroup
              toolCalls={group.toolCalls}
              pendingToolId={pendingToolId}
              onApproveTool={onApproveTool}
              onRejectTool={onRejectTool}
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
  onRejectTool,
  onOpenDiff,
  pendingToolId,
  hasCheckpoint,
}: ChatMessageProps) => {
  const message = messageProp

  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [copied, setCopied] = useState(false)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const { editorConfig, language } = useStore(useShallow(s => ({ editorConfig: s.editorConfig, language: s.language })))
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

  const handleCopy = () => {
    navigator.clipboard.writeText(textContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const tt = {
    copy: language === 'zh' ? '复制内容' : 'Copy Content',
    edit: language === 'zh' ? '编辑消息' : 'Edit Message',
    restore: language === 'zh' ? '恢复到此检查点' : 'Restore checkpoint',
    save: language === 'zh' ? '保存并重发' : 'Save & Resend',
    cancel: language === 'zh' ? '取消' : 'Cancel',
  }

  const [typingIndex, setTypingIndex] = useState(0)
  const { isStreaming, previewMap, liveParts, liveInteractive } = useAgentStore(useShallow(state => {
    if (!isAssistantMessage(message)) {
      return {
        isStreaming: false,
        previewMap: EMPTY_PREVIEWS,
        liveParts: undefined,
        liveInteractive: undefined,
      }
    }

    const threadId = state.currentThreadId
    const threadStreamState = threadId ? state.threads[threadId]?.streamState : undefined
    const liveMessage = threadId
      ? state.threads[threadId]?.messages.find(msg => msg.id === message.id && msg.role === 'assistant')
      : undefined
    const isActiveAssistant =
      Boolean(message.isStreaming) &&
      !!threadId &&
      threadStreamState?.assistantId === message.id &&
      ACTIVE_STREAM_PHASES.has(threadStreamState?.phase ?? 'idle')

    return {
      isStreaming: isActiveAssistant,
      liveParts: liveMessage && isAssistantMessage(liveMessage) ? liveMessage.parts : undefined,
      liveInteractive: liveMessage && isAssistantMessage(liveMessage) ? liveMessage.interactive : undefined,
      previewMap: isActiveAssistant
        ? state.threads[threadId!]?.toolStreamingPreviews || EMPTY_PREVIEWS
        : EMPTY_PREVIEWS,
    }
  }))

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

  const previewToolCalls = React.useMemo(() => {
    if (!isAssistantMessage(message)) return []

    const persistedIds = new Set((message.toolCalls || []).map(tc => tc.id))

    return Object.entries(previewMap)
      .filter(([id, preview]) => preview?.isStreaming && !persistedIds.has(id))
      .sort(([, left], [, right]) => (left.lastUpdateTime || 0) - (right.lastUpdateTime || 0))
      .map(([id, preview]) => ({
        id,
        name: preview.name || '...',
        arguments: preview.partialArgs || {},
        status: 'pending' as const,
      }))
  }, [message, previewMap])

  return (
    <div className={`
      w-full group/msg transition-colors duration-300
      ${isUser ? 'py-1 bg-transparent' : 'py-2 bg-transparent'}
    `}>
      <div className="w-full px-4 flex flex-col gap-1">

        {/* User Layout */}
        {isUser && (
          <div className="w-full flex flex-col items-end gap-1.5">
            {/* Header Row */}
            <div className="flex items-center gap-2.5 px-1 select-none">
              <span className="text-[11px] font-bold text-text-muted/60 uppercase tracking-tight">You</span>
              <div className="w-7 h-7 rounded-full bg-surface/60 border border-text-primary/10 flex items-center justify-center text-text-muted shadow-sm flex-shrink-0">
                <User className="w-3.5 h-3.5" />
              </div>
            </div>

            {/* Bubble / Editing */}
            <div className="flex flex-col items-end max-w-[85%] sm:max-w-[75%] min-w-0 mr-8 sm:mr-12 w-full">
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
                <div className="relative bg-surface/60 backdrop-blur-sm text-text-primary/95 px-4 py-3 rounded-[20px] rounded-tr-[4px] shadow-sm w-fit max-w-full border border-border/50">
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
                            onClick={() => setPreviewImage(imgSrc)}
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

                  <Modal isOpen={!!previewImage} onClose={() => setPreviewImage(null)} size="full" noPadding showCloseButton={false}>
                    <div
                      className="w-full h-full flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 cursor-zoom-out"
                      onClick={() => setPreviewImage(null)}
                    >
                      {previewImage && (
                        <img
                          src={previewImage}
                          alt="Preview"
                          className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                        />
                      )}
                    </div>
                  </Modal>

                  <div className="text-[14px] leading-relaxed">
                    <MarkdownContent content={textContent} fontSize={fontSize} />
                  </div>
                </div>
              )}

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
          </div>
        )}

        {/* Assistant Layout */}
        {!isUser && (
          <div className="w-full min-w-0 flex flex-col gap-2">
            <div className="flex items-center gap-3 px-1">
              <div className="w-9 h-9 rounded-xl overflow-hidden border border-border shadow-[0_4px_12px_-2px_rgba(0,0,0,0.1)] bg-surface/50 backdrop-blur-md relative flex-shrink-0">
                <div className="absolute inset-0 bg-accent/5 pointer-events-none" />
                <img src={publicAsset('brand/ip/ai-avatar.gif')} alt="AI" className="w-full h-full object-cover" />
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

              {!message.isStreaming && (
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
              {isAssistantMessage(message) && (message.contextItems?.some((item: any) => item.type === 'Skill') || assistantParts?.some(isSearchPart)) && (
                <MessageMetaGroup
                  autoSkills={message.contextItems?.filter((item: any) => item.type === 'Skill' && item.auto)}
                  manualSkills={message.contextItems?.filter((item: any) => item.type === 'Skill' && !item.auto)}
                  searchContent={assistantParts?.find(isSearchPart)?.content || undefined}
                  isSearchStreaming={(assistantParts?.find(isSearchPart) as any)?.isStreaming}
                />
              )}
              <div className="prose-custom w-full max-w-none">
                {assistantParts && (
                  <AssistantMessageContent
                    parts={assistantParts}
                    pendingToolId={pendingToolId}
                    onApproveTool={onApproveTool}
                    onRejectTool={onRejectTool}
                    onOpenDiff={onOpenDiff}
                    fontSize={fontSize}
                    isStreaming={message.isStreaming}
                    messageId={message.id}
                  />
                )}
                {previewToolCalls.length > 0 && (
                  <ToolCallGroup
                    toolCalls={previewToolCalls}
                    pendingToolId={pendingToolId}
                    onApproveTool={onApproveTool}
                    onRejectTool={onRejectTool}
                    onOpenDiff={onOpenDiff}
                    messageId={message.id}
                  />
                )}
              </div>

              {assistantInteractive && !message.isStreaming && (
                <div className="mt-2 w-full">
                  <InteractiveCard
                    content={assistantInteractive}
                    onSelect={(selectedIds, customText) => {
                      const selectedLabels = assistantInteractive.options
                        .filter(opt => selectedIds.includes(opt.id))
                        .map(opt => opt.label)
                      // 有自定义文本时，用自定义文本作为消息内容
                      const response = customText || selectedLabels.join(', ')
                      window.dispatchEvent(new CustomEvent('chat-update-interactive', { detail: { messageId: message.id, selectedIds } }))
                      window.dispatchEvent(new CustomEvent('chat-send-message', { detail: { content: response, messageId: message.id } }))
                    }}
                    disabled={!!assistantInteractive.selectedIds?.length}
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
