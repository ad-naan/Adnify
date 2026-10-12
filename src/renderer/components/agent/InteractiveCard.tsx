/**
 * 交互式选项卡片组件
 * 用于 ask_user 工具引导用户选择
 *
 * 设计风格：与 ToolCallCard 统一的扁平时间线结构
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
    Check, ChevronDown, CheckCircle2, Send, MessageSquare
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { InteractiveContent } from '@/renderer/agent/types'
import {
    AGENT_CONTENT_ENTER_TRANSITION,
} from '@/renderer/agent/presentation/disclosureMotion'
import {
    decideCustomDraftVisibility,
    isCustomOption,
    resolveInteractiveSubmission,
} from '@/renderer/agent/utils/interactiveResponse'
import { useStore } from '@store'
import { t } from '@shared/i18n'
import SmoothCollapse from './SmoothCollapse'
import { useDisclosureState } from '@renderer/hooks'

interface InteractiveCardProps {
    content: InteractiveContent
    onSelect: (selectedIds: string[], customText?: string) => void
    disabled?: boolean
}

export function InteractiveCard({ content, onSelect, disabled }: InteractiveCardProps) {
    const initiallySubmitted = Boolean(content.answeredAt || content.selectedIds?.length)
    const [selected, setSelected] = useState<Set<string>>(
        new Set(content.selectedIds || [])
    )
    const [submitted, setSubmitted] = useState(initiallySubmitted)
    const { isOpen: isExpanded, toggle: toggleExpanded, close: closeExpanded } = useDisclosureState({
        openWhile: !submitted && !disabled,
    })
    const submittedRef = useRef(initiallySubmitted)
    const [customText, setCustomText] = useState(content.customResponse || '')
    const [showCustomInput, setShowCustomInput] = useState(false)
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const language = useStore(s => s.language)

    useEffect(() => {
        if (content.answeredAt || content.selectedIds?.length) {
            setSelected(new Set(content.selectedIds))
            setSubmitted(true)
            submittedRef.current = true
            setCustomText(content.customResponse || '')
            if (disabled) {
                closeExpanded()
            }
        }
    }, [closeExpanded, content.answeredAt, content.customResponse, content.selectedIds, disabled])

    // 聚焦输入框
    useEffect(() => {
        if (showCustomInput && inputRef.current) {
            inputRef.current.focus()
        }
    }, [showCustomInput])

    const isMulti = Boolean(content.multiSelect)

    const submission = resolveInteractiveSubmission(content.options, Array.from(selected), customText)
    const hasCustomText = customText.trim().length > 0
    const hasSelectedOption = selected.size > 0
    const canSubmit = Boolean(submission) && !disabled && !submitted

    const submit = useCallback(() => {
        if (!submission || submittedRef.current) return
        submittedRef.current = true
        setSubmitted(true)
        onSelect(submission.ids, submission.kind === 'custom' ? submission.text : undefined)
        closeExpanded()
    }, [closeExpanded, onSelect, submission])

    /**
     * 选项行点下去只做一件事：选中/取消选中。
     *
     * 单选不再"点完即发送"：提交点收敛到确认按钮和回车，这样点错了还能改，
     * 自定义文本和选项之间也不会互相覆盖。多选和单选共用这一段，
     * 区别只在"选下一个"要不要清空上一个。
     */
    const handleToggle = useCallback((id: string) => {
        if (disabled || submittedRef.current) return

        setSelected(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else {
                if (!isMulti) next.clear()
                next.add(id)
            }
            return next
        })
    }, [disabled, isMulti])

    /**
     * 自定义行：开关输入框。"自定义回答"本身也是一个选项，勾上它输入框才出现，
     * 于是"写点什么"和"选一项"在提交时是同一条路。
     */
    const handleCustomRowToggle = useCallback(() => {
        if (disabled || submittedRef.current) return

        const willOpen = !showCustomInput
        setShowCustomInput(willOpen)

        const customId = content.options.find(isCustomOption)?.id
        if (!customId) return
        setSelected(prev => {
            const next = new Set(prev)
            // 取消勾选时手上还有草稿就先留着 —— 用户多半只是想看看别的选项。
            if (next.has(customId)) {
                if (!decideCustomDraftVisibility(true, customText)) next.delete(customId)
            } else {
                if (!isMulti) next.clear()
                next.add(customId)
            }
            return next
        })
    }, [content.options, customText, disabled, isMulti, showCustomInput])

    // 已选择的选项标签
    const selectedLabels = useMemo(() => content.options
        .filter(o => selected.has(o.id))
        .map(o => o.label)
        .join(', '), [content.options, selected])
    const answerSummary = customText.trim() || selectedLabels

    return (
        <div className={`group my-0.5 relative rounded-lg overflow-hidden transition-colors ${submitted
            ? 'hover:bg-text-primary/[0.02]'
            : 'bg-amber-500/5 border border-amber-500/15'
            }`}>
            {/* Header */}
            <div
                className="flex min-h-9 items-center gap-2 py-1.5 cursor-pointer select-none"
                onClick={toggleExpanded}
            >
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-text-muted/40 transition-transform duration-300 hover:text-text-muted motion-reduce:transition-none ${isExpanded ? 'rotate-0' : '-rotate-90'}`} />

                <div className="shrink-0 w-3.5 h-3.5 flex items-center justify-center">
                    {submitted ? (
                        <div className="w-3.5 h-3.5 rounded-full bg-green-500/10 flex items-center justify-center">
                            <CheckCircle2 className="w-2.5 h-2.5 text-green-500" />
                        </div>
                    ) : (
                        <div className="w-3.5 h-3.5 rounded-full bg-amber-500/20 flex items-center justify-center border border-amber-500/30">
                            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        </div>
                    )}
                </div>

                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-text-muted/55" aria-hidden="true" />

                <div className="flex-1 min-w-0 flex items-center gap-2 overflow-hidden relative z-10">
                    <span className={`text-[12px] truncate ${submitted
                        ? 'text-text-secondary group-hover:text-text-primary transition-colors'
                        : 'text-text-primary'
                        }`}>
                        {content.question}
                    </span>
                    {!isExpanded && submitted && answerSummary && (
                        <span className="text-[11px] text-text-muted/40 truncate">
                            - {answerSummary}
                        </span>
                    )}
                </div>
            </div>

            {/* Expanded Content */}
            <SmoothCollapse open={isExpanded}>
                <div className="pl-[26px] pr-3 pb-3 pt-0 relative border-t-0">
                    <div className="absolute left-[13.5px] top-0 bottom-3 w-[1.5px] bg-border/40 rounded-full" />

                    {/* Options */}
                    <div className="relative z-10 mt-1 space-y-0.5">
                        {content.options.map((option, index) => {
                            const isSelected = selected.has(option.id)
                            const isDisabled = disabled || submitted

                            return (
                                <motion.button
                                    key={option.id}
                                    type="button"
                                    initial={{ opacity: 0, x: -8 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{
                                        ...AGENT_CONTENT_ENTER_TRANSITION,
                                        delay: index * 0.03,
                                    }}
                                    onClick={() => handleToggle(option.id)}
                                    disabled={isDisabled}
                                    aria-pressed={isSelected}
                                    className={`
                                        agent-option-row
                                        w-full flex items-start gap-2.5 px-2.5 py-2 rounded-md text-left
                                        ${isSelected
                                            ? 'bg-accent/10 text-text-primary'
                                            : 'hover:bg-surface-hover/50 text-text-secondary'
                                        }
                                        ${isDisabled ? 'opacity-50 cursor-default' : 'cursor-pointer'}
                                    `}
                                >
                                    <OptionMark kind={isMulti ? 'checkbox' : 'radio'} isSelected={isSelected} />

                                    <div className="flex-1 min-w-0">
                                        <span className={`text-[12px] font-medium block truncate ${isSelected ? 'text-text-primary' : ''}`}>
                                            {option.label}
                                        </span>
                                        {option.description && (
                                            <span className="text-[10px] text-text-muted block truncate mt-0.5">
                                                {option.description}
                                            </span>
                                        )}
                                    </div>
                                </motion.button>
                            )
                        })}

                        {!submitted && (() => {
                            // 有些问题会把"自定义/其他"当普通选项给出，那一行就自己带输入框，
                            // 不再额外画一条 —— 同一个意思不该出现两次。
                            const customOption = content.options.find(isCustomOption)
                            return (
                                <button
                                    type="button"
                                    onClick={customOption ? () => handleToggle(customOption.id) : handleCustomRowToggle}
                                    aria-pressed={customOption ? selected.has(customOption.id) : showCustomInput}
                                    className={`agent-option-row relative z-10 flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left cursor-pointer ${showCustomInput
                                        ? 'bg-accent/10 text-text-primary'
                                        : 'hover:bg-surface-hover/50 text-text-secondary'
                                    }`}
                                >
                                    <OptionMark kind={customOption ? (isMulti ? 'checkbox' : 'radio') : 'custom'} isSelected={showCustomInput} />
                                    <span className="min-w-0 flex-1 text-[12px] font-medium truncate">
                                        {customOption?.label ?? t('common.customResponse', language)}
                                    </span>
                                </button>
                            )
                        })()}
                    </div>

                    {/* Custom Text Input */}
                    <AnimatePresence initial={false}>
                        {showCustomInput && !submitted && (
                            <motion.div
                                key="custom-input"
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={AGENT_CONTENT_ENTER_TRANSITION}
                                className="relative z-10 ml-[24px] mt-1.5 overflow-hidden"
                            >
                                <div className="relative">
                                    <textarea
                                        ref={inputRef}
                                        value={customText}
                                        onChange={e => setCustomText(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault()
                                                submit()
                                            }
                                        }}
                                        placeholder={t('interactiveCard.typeYourCustomResponse', language)}
                                        rows={2}
                                        className="w-full px-3 py-2 pr-10 text-[12px] text-text-primary bg-surface/60 border border-border/50 rounded-lg resize-none focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 placeholder:text-text-muted/40 transition-all custom-scrollbar"
                                    />
                                    <button
                                        type="button"
                                        onClick={submit}
                                        disabled={!canSubmit}
                                        className={`absolute right-2 bottom-2 p-1 rounded-md transition-all ${canSubmit
                                            ? 'text-accent hover:bg-accent/10 active:scale-90'
                                            : 'text-text-muted/30 cursor-not-allowed'
                                            }`}
                                        title={t('interactiveCard.send', language)}
                                    >
                                        <Send className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* 同一个提交点：选项和自定义回答都从这里出去，回车等价于点它 */}
                    {!submitted && (
                        <div className="mt-2 flex items-center justify-between gap-3 relative z-10">
                            <span className="min-w-0 text-[10px] leading-4 text-text-muted/60">
                                {hasCustomText
                                    ? t('interactiveCard.pressEnterToSend', language)
                                    : hasSelectedOption
                                        ? ''
                                        : isMulti
                                            ? t('interactiveCard.pickOneOrMore', language)
                                            : t('interactiveCard.pickOneOption', language)}
                            </span>
                            <button
                                type="button"
                                onClick={submit}
                                disabled={!canSubmit}
                                className={`
                                    flex shrink-0 items-center gap-1.5 px-3 py-1 min-h-7 text-[11px] font-medium rounded-md transition-all
                                    ${canSubmit
                                        ? 'bg-accent text-white hover:bg-accent-hover active:scale-95'
                                        : 'bg-surface/50 text-text-muted/70 cursor-not-allowed'
                                    }
                                `}
                            >
                                <span>{isMulti
                                    ? t('interactiveCard.confirm', language, { size: selected.size })
                                    : t('interactiveCard.sendAnswer', language)}</span>
                                <Send className="w-3 h-3" />
                            </button>
                        </div>
                    )}
                </div>
            </SmoothCollapse>
        </div>
    )
}

/**
 * 选项前的标记：单选画圆点、多选画方块、自定义画发送箭头。
 * 形状差异先于文字被读到，所以按控件类型区分，而不是只靠主题色。
 */
function OptionMark({ kind, isSelected }: { kind: 'radio' | 'checkbox' | 'custom'; isSelected: boolean }) {
    const shape = kind === 'radio' ? 'rounded-full' : kind === 'checkbox' ? 'rounded-[4px]' : 'rounded-full'

    return (
        <span
            aria-hidden="true"
            className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center border transition-colors duration-150 ${shape} ${isSelected
                ? 'border-accent bg-accent text-white'
                : 'border-text-muted/30 text-text-muted/50'
                }`}
        >
            {isSelected
                ? <Check className="w-2 h-2" strokeWidth={3} />
                : kind === 'custom'
                    ? <Send className="w-1.5 h-1.5" />
                    : null}
        </span>
    )
}
