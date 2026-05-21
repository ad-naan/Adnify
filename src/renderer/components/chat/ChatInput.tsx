/**
 * 聊天输入组件
 * 极致打磨：悬浮光晕、灵动按钮、精致上下文药丸
 */
import { memo, useRef, useCallback, useMemo, useState, useLayoutEffect } from 'react'
import {
  FileText,
  X,
  Code,
  GitBranch,
  Terminal,
  Database,
  ArrowUp,
  Plus,
  Folder,
  Globe,
  Wrench,
  Server,
  Image as ImageIcon,
  ListOrdered,
  Maximize2,
  Minimize2
} from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { getFileName } from '@shared/utils/pathUtils'
import { WorkMode } from '@/renderer/modes/types'
import { motion, AnimatePresence } from 'framer-motion'
import { t } from '@renderer/i18n'
import { Button } from '../ui'
import ModelSelector from './ModelSelector'
import ModeSelector from './ModeSelector'
import { KaomojiPet } from './KaomojiPet'

import { ContextItem, FileContext } from '@/renderer/agent/types'

const COLLAPSED_TEXTAREA_HEIGHT = 132
const LONG_TEXT_THRESHOLD = 168

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
  chatMode: WorkMode
  setChatMode: (mode: WorkMode) => void
  onSubmit: () => void
  onAbort: () => void
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onPaste: (e: React.ClipboardEvent) => void
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
  chatMode,
  setChatMode,
  onSubmit,
  onAbort,
  onInputChange,
  onKeyDown,
  onPaste,
  textareaRef,
  inputContainerRef,
  contextItems,
  onRemoveContextItem,
  activeFilePath,
  onAddFile,
}: ChatInputProps) {
  const { language, editorConfig } = useStore(useShallow(s => ({ language: s.language, editorConfig: s.editorConfig })))
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [isInputExpanded, setIsInputExpanded] = useState(false)
  const [canCollapseInput, setCanCollapseInput] = useState(false)

  // Auto-resize
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.style.height = 'auto'
    const fullHeight = textarea.scrollHeight
    const isLongInput = fullHeight > LONG_TEXT_THRESHOLD
    const maxExpandedHeight = Math.max(220, Math.floor(window.innerHeight * 0.5))
    const targetHeight = isLongInput && !isInputExpanded
      ? COLLAPSED_TEXTAREA_HEIGHT
      : Math.min(fullHeight, maxExpandedHeight)

    setCanCollapseInput(isLongInput)
    if (!isLongInput && isInputExpanded) {
      setIsInputExpanded(false)
    }

    textarea.style.height = `${targetHeight}px`
    textarea.style.overflowY = fullHeight > targetHeight ? 'auto' : 'hidden'
  }, [input, isInputExpanded, textareaRef])

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

  return (
    <div ref={inputContainerRef} className="z-20">
      <div
        className={`
            process-fluid-input relative group flex flex-col rounded-xl transition-all duration-500 ease-out backdrop-blur-md
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
        <div className="flex flex-col px-4 pb-3 pt-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={onInputChange}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={hasApiKey ? t('pasteImagesHint', language) : t('configureApiKey', language)}
            disabled={!hasApiKey}
            className="w-full bg-transparent border-none p-0 py-2.5
                       text-[15px] text-text-primary placeholder-text-muted/40 resize-none
                       focus:ring-0 focus:outline-none leading-relaxed custom-scrollbar max-h-[50vh] caret-accent font-medium tracking-wide"
            rows={1}
            style={{ minHeight: '48px', fontSize: `${Math.max(14, editorConfig.chatFontSize ?? editorConfig.fontSize)}px` }}
          />

          {canCollapseInput && (
            <div className="-mt-1 flex justify-end pb-1">
              <button
                type="button"
                onClick={() => setIsInputExpanded(prev => !prev)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-text-muted/55 transition-colors hover:bg-text-primary/[0.04] hover:text-text-secondary"
                title={isInputExpanded
                  ? (language === 'zh' ? '收起输入内容' : 'Collapse input')
                  : (language === 'zh' ? '展开输入内容' : 'Expand input')}
              >
                {isInputExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                <span>{isInputExpanded ? (language === 'zh' ? '收起' : 'Collapse') : (language === 'zh' ? '展开' : 'Expand')}</span>
              </button>
            </div>
          )}

          {/* Bottom Actions */}
          <div className="relative flex items-center justify-between pt-1 gap-2">
            <div className="flex items-center gap-2 opacity-80 hover:opacity-100 transition-opacity flex-1 min-w-0">
              <ModeSelector mode={chatMode} onModeChange={setChatMode} className="shrink-0" />
              <ModelSelector alignLeft className="max-w-[260px]" />
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
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
              <Button
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                title={t('uploadImage', language)}
                className="rounded-xl w-8 h-8 hover:bg-surface-active text-text-muted hover:text-text-primary transition-all active:scale-95"
              >
                <ImageIcon className="w-4 h-4 opacity-70 group-hover:opacity-100" />
              </Button>

              {/* Send / Queue / Stop buttons */}
              {isStreaming ? (
                <div className="flex items-center gap-1.5">
                  {/* Queue Send button - visible when there's input during streaming */}
                  {isSendable && (
                    <button
                      onClick={onSubmit}
                      disabled={!hasApiKey || hasPendingToolCall}
                      title={language === 'zh' ? '加入队列 (⏎)' : 'Queue message (⏎)'}
                      className="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300 bg-accent/80 text-white shadow-sm shadow-accent/10 hover:bg-accent hover:shadow-accent/30 hover:-translate-y-0.5 active:translate-y-0 border border-transparent"
                    >
                      <ListOrdered className="w-4 h-4 stroke-[2.5]" />
                    </button>
                  )}
                  {/* Stop button */}
                  <button
                    onClick={onAbort}
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300 bg-surface/50 text-text-primary border border-text-primary/10 hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/20"
                  >
                    <div className="w-2.5 h-2.5 bg-current rounded-[1px] animate-pulse" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={onSubmit}
                  disabled={!hasApiKey || !isSendable || hasPendingToolCall}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300
                    ${isSendable
                      ? 'bg-accent text-white shadow-md shadow-accent/20 hover:shadow-accent/40 hover:-translate-y-0.5 active:translate-y-0 border border-transparent'
                      : 'bg-text-primary/5 text-text-muted/30 cursor-not-allowed border border-transparent'
                    }
                  `}
                >
                  <ArrowUp className="w-5 h-5 stroke-[3]" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Footer Area */}
      <div className="mt-3.5 mb-1 flex items-center justify-between px-4 pb-1">

        {/* Left Side: Dynamic Pet */}
        <div className="hidden sm:flex items-center">
          <KaomojiPet language={language} />
        </div>

        {/* Right Side: Key Shortcuts */}
        <div className="hidden sm:flex items-center gap-2 text-[10px] text-text-muted/40 font-medium tracking-wide whitespace-nowrap overflow-hidden shrink-0">
          <span>{isStreaming ? '⏎ Queue' : '⏎ Send'}</span>
          <span className="w-1 h-1 rounded-full bg-current opacity-30" />
          <span>⇧⏎ New Line</span>
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
