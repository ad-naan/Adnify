/**
 * 聊天输入组件
 * 极致打磨：悬浮光晕、灵动按钮、精致上下文药丸
 */
import { memo, useRef, useCallback, useMemo, useState, useLayoutEffect } from 'react'
import {
  FileText, X, Code, GitBranch, Terminal, Database, ArrowUp, Plus, Folder, Globe, Wrench, Server, ListOrdered, Maximize2, Minimize2, LoaderCircle
} from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { getFileName } from '@shared/utils/pathUtils'
import { motion, AnimatePresence } from 'framer-motion'
import { t } from '@shared/i18n'
import ModelSelector from './ModelSelector'
import ReasoningParticleSlider from './ReasoningParticleSlider'
import { KaomojiPet } from './KaomojiPet'
import { useDecorativeAnimations } from '@/renderer/hooks/useDecorativeAnimations'

import { ContextItem, FileContext } from '@/renderer/agent/types'

function MediaUploadIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect
        x="2.5"
        y="2.5"
        width="15"
        height="15"
        rx="3.75"
        className="stroke-current stroke-[1.6]"
      />
      <circle
        cx="7"
        cy="7"
        r="1.8"
        className="fill-current group-hover/btn:fill-accent transition-colors"
      />
      <path
        d="M3.2 16.5L7.8 11.2C8.3 10.6 9.3 10.6 9.8 11.2L11.5 13L13.8 10C14.3 9.4 15.3 9.4 15.8 10L16.8 11.2V16.5H3.2Z"
        className="fill-current opacity-15 group-hover/btn:opacity-25 transition-opacity"
      />
      <path
        d="M3.2 16.5L7.8 11.2C8.3 10.6 9.3 10.6 9.8 11.2L11.5 13L13.8 10C14.3 9.4 15.3 9.4 15.8 10L16.8 11.2"
        className="stroke-current stroke-[1.6] stroke-linecap-round stroke-linejoin-round"
      />
    </svg>
  )
}

function PromptMagicIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M10 2.5C10 6.64 13.36 10 17.5 10C13.36 10 10 13.36 10 17.5C10 13.36 6.64 10 2.5 10C6.64 10 10 6.64 10 2.5Z"
        className="fill-current opacity-15 group-hover/btn:opacity-30 transition-opacity"
      />
      <path
        d="M10 2.5C10 6.64 13.36 10 17.5 10C13.36 10 10 13.36 10 17.5C10 13.36 6.64 10 2.5 10C6.64 10 10 6.64 10 2.5Z"
        className="stroke-current stroke-[1.5] stroke-linejoin-round"
      />
      <path
        d="M15.5 3C15.5 4.38 16.62 5.5 18 5.5C16.62 5.5 15.5 6.62 15.5 8C15.5 6.62 14.38 5.5 13 5.5C14.38 5.5 15.5 4.38 15.5 3Z"
        className="fill-current group-hover/btn:fill-accent transition-colors"
      />
      <circle
        cx="4.5"
        cy="15.5"
        r="1.25"
        className="fill-current group-hover/btn:fill-accent transition-colors"
      />
    </svg>
  )
}

const COLLAPSED_TEXTAREA_HEIGHT = 132
const LONG_TEXT_THRESHOLD = 168
const REGULAR_TEXTAREA_HEIGHT = 48
const COMPACT_TEXTAREA_HEIGHT = 36

export interface PendingImage {
  id: string
  file: File
  previewUrl: string
  base64?: string
}

interface ChatInputProps {
  input: string
  setInput: (value: string) => void
  images: PendingImage[]
  setImages: React.Dispatch<React.SetStateAction<PendingImage[]>>
  isStreaming: boolean
  hasApiKey: boolean
  hasPendingToolCall: boolean
  compact?: boolean
  placeholder?: string
  onSubmit: () => void
  onAbort: () => void
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onPaste: (e: React.ClipboardEvent) => void
  onOptimizePrompt: () => void
  isOptimizingPrompt: boolean
  textareaRef: React.RefObject<HTMLTextAreaElement>
  inputContainerRef: React.RefObject<HTMLDivElement>
  contextItems: ContextItem[]
  onRemoveContextItem: (item: ContextItem) => void
  activeFilePath?: string | null
  onAddFile?: (filePath: string) => void
}

const ChatInput = memo(function ChatInput({
  input,
  images,
  setImages,
  isStreaming,
  hasApiKey,
  hasPendingToolCall,
  compact = false,
  placeholder,
  onSubmit,
  onAbort,
  onInputChange,
  onKeyDown,
  onPaste,
  onOptimizePrompt,
  isOptimizingPrompt,
  textareaRef,
  inputContainerRef,
  contextItems,
  onRemoveContextItem,
  activeFilePath,
  onAddFile,
}: ChatInputProps) {
  const { language, editorConfig, llmConfig, update } = useStore(useShallow(s => ({
    language: s.language,
    editorConfig: s.editorConfig,
    llmConfig: s.llmConfig,
    update: s.update,
  })))
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isFocused, setIsFocused] = useState(false)
  const decorativeAnimations = useDecorativeAnimations()
  const [isInputExpanded, setIsInputExpanded] = useState(false)
  const [canCollapseInput, setCanCollapseInput] = useState(false)

  // Auto-resize
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    const minimumHeight = compact ? COMPACT_TEXTAREA_HEIGHT : REGULAR_TEXTAREA_HEIGHT

    // An empty textarea can briefly report a stale scrollHeight while the panel is
    // mounting (or while the UI font is being swapped in).  That stale measurement
    // used to make a fresh composer look like it already contained several lines.
    // Give the empty state a deterministic height and only measure real content.
    if (!input) {
      textarea.style.height = `${minimumHeight}px`
      textarea.style.overflowY = 'hidden'
      setCanCollapseInput(false)
      setIsInputExpanded(false)
      return
    }

    textarea.style.height = '0px'
    const fullHeight = textarea.scrollHeight
    const isLongInput = fullHeight > LONG_TEXT_THRESHOLD
    const maxExpandedHeight = Math.max(220, Math.floor(window.innerHeight * 0.5))
    const targetHeight = isLongInput && !isInputExpanded
      ? COLLAPSED_TEXTAREA_HEIGHT
      : Math.max(minimumHeight, Math.min(fullHeight, maxExpandedHeight))

    setCanCollapseInput(isLongInput)
    if (!isLongInput && isInputExpanded) {
      setIsInputExpanded(false)
    }

    textarea.style.height = `${targetHeight}px`
    textarea.style.overflowY = fullHeight > targetHeight ? 'auto' : 'hidden'
  }, [compact, input, isInputExpanded, textareaRef])

  // 文件引用检测
  const fileRefs = useMemo(() => {
    const refs: string[] = []
    const regex = /@(?:file:)?([^\s@]+\.[a-zA-Z0-9]+)/g
    let match
    while ((match = regex.exec(input)) !== null) {
      if (match[1] !== 'codebase') {
        refs.push(match[1])
      }
    }
    return refs
  }, [input])

  // 特殊上下文引用检测
  const hasCodebaseRef = useMemo(() => /@codebase\b/i.test(input), [input])
  const hasSymbolsRef = useMemo(() => /@symbols\b/i.test(input), [input])
  const hasGitRef = useMemo(() => /@git\b/i.test(input), [input])
  const hasTerminalRef = useMemo(() => /@terminal\b/i.test(input), [input])
  const hasWebRef = useMemo(() => /@web\b/i.test(input), [input])

  // 添加图片
  const addImage = useCallback(async (file: File) => {
    const id = crypto.randomUUID()
    const previewUrl = URL.createObjectURL(file)

    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      setImages((prev) => prev.map((img) => (img.id === id ? { ...img, base64 } : img)))
    }
    reader.readAsDataURL(file)

    setImages((prev) => [...prev, { id, file, previewUrl }])
  }, [setImages])

  // 移除图片
  const removeImage = useCallback(
    (id: string) => {
      setImages((prev) => {
        const target = prev.find((img) => img.id === id)
        if (target) URL.revokeObjectURL(target.previewUrl)
        return prev.filter((img) => img.id !== id)
      })
    },
    [setImages]
  )

  const isSendable = input.trim().length > 0 || images.length > 0
  const reasoningOptions = useMemo(() => {
    const labels = {
      none: t('chatInput.off', language),
      minimal: t('chatInput.minimal', language),
      low: t('emotion.sensitivityLow', language),
      medium: t('emotion.sensitivityMedium', language),
      high: t('emotion.sensitivityHigh', language),
      xhigh: t('chatInput.xHigh', language),
      max: t('chatInput.max', language),
    } as const
    const protocol = llmConfig.protocol
    const supported = llmConfig.provider === 'anthropic' || protocol === 'anthropic'
      ? ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const
      : llmConfig.provider === 'gemini' || protocol === 'google'
        ? ['none', 'minimal', 'low', 'medium', 'high'] as const
        : llmConfig.openAICompatibilityProfile === 'compatible'
          ? llmConfig.capabilities?.openAICompatibleSupportsExtendedReasoningEffort
            ? ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
            : ['none', 'minimal', 'low', 'medium', 'high'] as const
          : ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

    return supported.map(value => ({ value, label: labels[value] }))
  }, [language, llmConfig.capabilities?.openAICompatibleSupportsExtendedReasoningEffort, llmConfig.openAICompatibilityProfile, llmConfig.protocol, llmConfig.provider])
  const selectedReasoningEffort = llmConfig.enableThinking
    ? (reasoningOptions.some(option => option.value === llmConfig.reasoningEffort)
      ? llmConfig.reasoningEffort ?? 'medium'
      : 'medium')
    : 'none'

  return (
    <div ref={inputContainerRef} className="z-20 min-w-0 max-w-full">
      <div
        className={`
            process-fluid-input relative group flex flex-col rounded-xl transition-shadow duration-300 ease-out
            ${decorativeAnimations && (isFocused || isStreaming) ? 'process-fluid-input--animated' : ''}
            ${isStreaming
            ? 'process-fluid-input--streaming'
            : isFocused
              ? 'process-fluid-input--focused'
              : ''
          }
        `}
      >
        {/* Image Previews */}
        {images.length > 0 && (
          <div className="flex gap-3 px-4 pt-4 overflow-x-auto custom-scrollbar">
            {images.map((img) => (
              <div
                key={img.id}
                className="relative group/img flex-shrink-0 w-16 h-16 rounded-xl overflow-hidden border border-border shadow-sm"
              >
                <img src={img.previewUrl} alt="preview" className="w-full h-full object-cover" />
                <button
                  onClick={() => removeImage(img.id)}
                  className="absolute top-1 right-1 p-1 bg-black/60 backdrop-blur rounded-full text-white hover:bg-red-500 transition-all opacity-0 group-hover/img:opacity-100 scale-90 hover:scale-100"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Context Display Area (Top) */}
        {(contextItems.length > 0 || hasCodebaseRef || hasSymbolsRef || hasGitRef || hasTerminalRef || hasWebRef || fileRefs.length > 0 || (activeFilePath && onAddFile && !contextItems.some(i => i.type === 'File' && (i as FileContext).uri === activeFilePath))) && (
          <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3 pb-1 border-b border-border/10">
            <AnimatePresence>
              {/* Active File Suggestion */}
              {activeFilePath && onAddFile && !contextItems.some(i => i.type === 'File' && (i as FileContext).uri === activeFilePath) && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  onClick={() => {
                    onAddFile(activeFilePath)
                    // 这里如果能自动清除输入框里的失焦状态体验会更好，暂通过 state 刷新实现
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-accent/5 text-accent text-[11px] font-medium rounded-lg border border-accent/10 select-none hover:bg-accent/10 transition-colors"
                >
                  <Plus className="w-3 h-3" strokeWidth={3} />
                  <span>{getFileName(activeFilePath)}</span>
                </motion.button>
              )}

              {/* Context Items */}
              {contextItems.filter(item => ['File', 'Folder', 'CodeSelection', 'Skill', 'ShellServer'].includes(item.type)).map((item, i) => {
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
                      const uri = (item as import('@/renderer/agent/types').FileContext).uri || ''
                      return getFileName(uri) || uri
                    }
                    case 'CodeSelection': {
                      const codeItem = item as import('@/renderer/agent/types').CodeSelectionContext
                      const uri = codeItem.uri || ''
                      const range = codeItem.range as [number, number] | undefined
                      const name = getFileName(uri) || uri
                      return range ? `${name}:${range[0]}-${range[1]}` : name
                    }
                    case 'Skill': {
                      return `@${(item as import('@/renderer/agent/types').SkillContext).skillId || 'skill'}`
                    }
                    case 'ShellServer': {
                      return `#${(item as import('@/renderer/agent/types').ShellServerContext).serverName}#`
                    }
                    default: return 'Context'
                  }
                })()

                return (
                  <motion.span
                    key={`${item.type}-${'uri' in item ? (item as { uri: string }).uri : i}`}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8, filter: 'blur(4px)' }}
                    transition={{ duration: 0.15 }}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 ${style.bg} ${style.text} text-[11px] font-medium rounded-lg border ${style.border} select-none group/chip transition-all hover:border-opacity-100 hover:shadow-sm`}
                  >
                    <style.Icon className="w-3 h-3 opacity-70" />
                    <span className="max-w-[120px] truncate">{label}</span>
                    <button
                      onClick={() => onRemoveContextItem(item)}
                      className="ml-0.5 p-0.5 rounded-full hover:bg-black/20 text-current hover:text-red-400 opacity-60 group-hover/chip:opacity-100 transition-all"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </motion.span>
                )
              })}
            </AnimatePresence>

            {/* Other Reference Chips */}
            {hasCodebaseRef && <ContextChip icon={Database} label="@codebase" color="green" />}
            {hasSymbolsRef && <ContextChip icon={Code} label="@symbols" color="pink" />}
            {hasGitRef && <ContextChip icon={GitBranch} label="@git" color="orange" />}
            {hasTerminalRef && <ContextChip icon={Terminal} label="@terminal" color="cyan" />}
            {hasWebRef && <ContextChip icon={Globe} label="@web" color="blue" />}
          </div>
        )}

        {/* Input Area */}
        <div className={`flex flex-col ${compact ? 'px-3 pb-2 pt-1' : 'px-4 pb-3 pt-2'}`}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={onInputChange}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={hasApiKey ? placeholder || t('pasteImagesHint', language) : t('configureApiKey', language)}
            disabled={!hasApiKey || isOptimizingPrompt}
            className={`w-full bg-transparent border-none p-0
                       text-[15px] text-text-primary placeholder-text-muted/40 resize-none
                       focus:ring-0 focus:outline-none leading-relaxed custom-scrollbar max-h-[50vh] caret-accent font-medium tracking-wide ${compact ? 'py-1.5' : 'py-2.5'}`}
            rows={1}
            style={{
              boxSizing: 'border-box',
              minHeight: compact ? `${COMPACT_TEXTAREA_HEIGHT}px` : `${REGULAR_TEXTAREA_HEIGHT}px`,
              fontSize: `${Math.max(14, editorConfig.chatFontSize ?? editorConfig.fontSize)}px`,
            }}
          />

          {canCollapseInput && (
            <div className="-mt-1 flex justify-end pb-1">
              <button
                type="button"
                onClick={() => setIsInputExpanded(prev => !prev)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-text-muted/55 transition-colors hover:bg-text-primary/[0.04] hover:text-text-secondary"
                title={isInputExpanded
                  ? (t('chatInput.collapseInput', language))
                  : (t('chatInput.expandInput', language))}
              >
                {isInputExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                <span>{isInputExpanded ? (t('toolCollapse', language)) : (t('chatInput.expand', language))}</span>
              </button>
            </div>
          )}

          {/* Bottom Actions */}
          <div className="relative flex items-center justify-between pt-1 gap-2">
            <div className="flex flex-1 min-w-0 items-center overflow-hidden">
              <ModelSelector alignLeft className="flex-1 max-w-full" />
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <ReasoningParticleSlider
                options={reasoningOptions}
                value={selectedReasoningEffort}
                enabled={!!llmConfig.enableThinking}
                language={language}
                onChange={(reasoningEffort) => update('llmConfig', {
                  enableThinking: reasoningEffort !== 'none',
                  reasoningEffort: reasoningEffort as typeof llmConfig.reasoningEffort,
                })}
                onCommit={() => void useStore.getState().save()}
              />

              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*"
                multiple
                onChange={(e) => {
                  if (e.target.files) {
                    Array.from(e.target.files).forEach(addImage)
                  }
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title={t('uploadImage', language)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06] transition-all duration-150 active:scale-90 group/btn"
              >
                <MediaUploadIcon className="w-[18px] h-[18px] opacity-75 group-hover/btn:opacity-100 group-hover/btn:scale-105 transition-all" />
              </button>

              <button
                type="button"
                onClick={onOptimizePrompt}
                disabled={!hasApiKey || !input.trim() || isOptimizingPrompt || isStreaming}
                title={t('chatInput.improveThePromptUsing', language)}
                aria-label={t('chatInput.improvePrompt', language)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-accent hover:bg-accent/10 transition-all duration-150 active:scale-90 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-muted disabled:cursor-not-allowed group/btn"
              >
                {isOptimizingPrompt
                  ? <LoaderCircle className="h-4 w-4 animate-spin text-accent" />
                  : <PromptMagicIcon className="w-[18px] h-[18px] opacity-75 group-hover/btn:opacity-100 group-hover/btn:scale-105 transition-all" />}
              </button>

              {/* Send / Queue / Stop buttons */}
              {isStreaming ? (
                <div className="flex items-center gap-1">
                  {/* Queue Send button - visible when there's input during streaming */}
                  {isSendable && (
                    <button
                      type="button"
                      onClick={onSubmit}
                      disabled={!hasApiKey || hasPendingToolCall}
                      title={t('chatInput.queueMessage', language)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200 bg-accent hover:bg-accent-hover text-white shadow-md shadow-accent/25 hover:shadow-accent/40 hover:-translate-y-0.5 active:translate-y-0 active:scale-92"
                    >
                      <ListOrdered className="w-4 h-4 stroke-[2.5]" />
                    </button>
                  )}
                  {/* Stop button - illuminated emergency tactile kill switch */}
                  <button
                    type="button"
                    onClick={onAbort}
                    title={t('common.stop', language)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center bg-red-500/10 hover:bg-red-500/20 text-red-500 active:scale-90 transition-all duration-150 group/stop"
                  >
                    <div className="w-2.5 h-2.5 rounded-[2px] bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)] group-hover/stop:scale-110 transition-transform" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={!hasApiKey || !isSendable || hasPendingToolCall}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200
                    ${isSendable
                      ? 'bg-accent hover:bg-accent-hover text-white shadow-md shadow-accent/25 hover:shadow-accent/40 hover:-translate-y-0.5 active:translate-y-0 active:scale-92'
                      : 'bg-text-primary/[0.05] text-text-muted/30 cursor-not-allowed'
                    }
                  `}
                >
                  <ArrowUp className="w-4 h-4 stroke-[2.75]" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Footer Area */}
      <div className="mt-3 mb-1 flex min-h-9 items-center justify-between gap-4 px-4 pb-1">

        {/* Left Side: Dynamic Pet */}
        <div className="hidden min-w-0 flex-1 sm:flex items-center">
          <KaomojiPet language={language} isStreaming={isStreaming} hasInput={isSendable} />
        </div>

        {/* Right Side: Key Shortcuts */}
        <div className="hidden sm:flex items-center gap-2 text-[10px] text-text-muted/45 font-medium tracking-wide whitespace-nowrap overflow-hidden shrink-0">
          <span>{isStreaming ? 'Enter Queue' : 'Enter Send'}</span>
          <span className="w-1 h-1 rounded-full bg-current opacity-30" />
          <span>Shift Enter New Line</span>
        </div>
      </div>
    </div>
  )
})

export default ChatInput

// 辅助组件：上下文 Chip
function ContextChip({ icon: Icon, label, color }: { icon: any, label: string, color: string }) {
  const colorMap: Record<string, string> = {
    green: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
    pink: 'text-pink-400 bg-pink-400/10 border-pink-400/20',
    orange: 'text-orange-400 bg-orange-400/10 border-orange-400/20',
    cyan: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20',
    blue: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 ${colorMap[color]} text-[11px] font-medium rounded-lg border animate-fade-in select-none`}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  )
}
