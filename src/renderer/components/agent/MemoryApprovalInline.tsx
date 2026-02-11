import React, { useState, useEffect } from 'react'
import { Sparkles, Edit2, Check, ChevronDown, CheckCircle2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAgentStore } from '@renderer/agent/store/AgentStore'
import { useStore } from '@store'

interface MemoryApprovalInlineProps {
    content: string
    isAwaitingApproval: boolean
    isSuccess?: boolean
    messageId: string
    toolCallId: string
    args: Record<string, any>
}

export const MemoryApprovalInline: React.FC<MemoryApprovalInlineProps> = ({
    content,
    isAwaitingApproval,
    isSuccess,
    messageId,
    toolCallId,
    args
}) => {
    const [isEditing, setIsEditing] = useState(false)
    const [isExpanded, setIsExpanded] = useState(!isSuccess)
    const [editedContent, setEditedContent] = useState(content)
    const { language } = useStore()

    useEffect(() => {
        if (!isEditing) {
            setEditedContent(content)
        }
    }, [content, isEditing])

    useEffect(() => {
        if (isSuccess) {
            setIsExpanded(false)
        }
    }, [isSuccess])

    const handleSave = () => {
        useAgentStore.getState().updateToolCall(messageId, toolCallId, {
            arguments: { ...args, content: editedContent }
        })
        setIsEditing(false)
    }

    const titleText = isSuccess
        ? (language === 'zh' ? '已存入项目记忆' : 'Project Memory Stored')
        : (language === 'zh' ? 'AI 记忆提议' : 'Memory Proposal')

    return (
        <div className="my-3 group/memory-v5 select-none overflow-hidden">
            {/* 顶部标题行 */}
            <div
                onClick={() => !isEditing && setIsExpanded(!isExpanded)}
                className="flex items-center gap-2.5 cursor-pointer group/header py-1.5"
            >
                {/* 动态图标座 */}
                <div className="relative flex items-center justify-center w-5 h-5">
                    <AnimatePresence mode="wait">
                        {isSuccess ? (
                            <motion.div
                                key="success"
                                initial={{ scale: 0, rotate: -45 }}
                                animate={{ scale: 1, rotate: 0 }}
                                className="text-green-500/80"
                            >
                                <CheckCircle2 className="w-4 h-4" />
                            </motion.div>
                        ) : (
                            <motion.div
                                key="proposal"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="relative"
                            >
                                <div className="absolute inset-0 bg-accent/30 blur-md rounded-full animate-pulse" />
                                <Sparkles className="relative w-4 h-4 text-accent" />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* 描述文字 */}
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className={`text-[11px] font-bold tracking-tight uppercase whitespace-nowrap ${isSuccess ? 'text-text-muted/40' : 'text-accent/90'
                        }`}>
                        {titleText}
                    </span>
                    {!isExpanded && (
                        <span className="text-[11px] text-text-muted/30 truncate font-sans tracking-wide">
                            — {content.slice(0, 45)}...
                        </span>
                    )}
                </div>

                {/* 状态指示器 */}
                <div className={`transition-all duration-300 ${isExpanded ? 'rotate-0 opacity-100' : '-rotate-90 opacity-40'} text-text-muted group-hover/header:opacity-100`}>
                    <ChevronDown className="w-3.5 h-3.5" />
                </div>
            </div>

            {/* 展开内容区域 */}
            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ type: 'spring', damping: 28, stiffness: 220 }}
                    >
                        <div className="relative mt-1 ml-[9px] pl-5 pb-2">
                            {/* 线性渐变侧边装饰线 */}
                            <div className={`absolute left-[-1px] top-0 bottom-2 w-[1.5px] rounded-full transition-all duration-700 ${isSuccess
                                ? 'bg-gradient-to-b from-green-500/30 via-green-500/10 to-transparent'
                                : 'bg-gradient-to-b from-accent/50 via-purple-500/30 to-transparent'
                                }`} />

                            {isEditing ? (
                                <div className="space-y-3 py-2">
                                    <textarea
                                        value={editedContent}
                                        onChange={(e) => setEditedContent(e.target.value)}
                                        className="w-full h-28 p-3 bg-white/[0.03] rounded-xl border border-white/10 text-xs text-text-primary focus:border-accent/40 outline-none transition-all resize-none font-sans leading-relaxed shadow-inner"
                                        autoFocus
                                    />
                                    <div className="flex justify-end gap-2.5">
                                        <button
                                            onClick={() => setIsEditing(false)}
                                            className="px-3 py-1.5 text-[10px] font-semibold text-text-muted hover:text-text-primary transition-colors rounded-md hover:bg-white/5"
                                        >
                                            {language === 'zh' ? '放弃' : 'Discard'}
                                        </button>
                                        <button
                                            onClick={handleSave}
                                            className="flex items-center gap-1.5 px-4 py-1.5 text-[10px] font-black bg-accent text-white rounded-lg shadow-xl shadow-accent/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                                        >
                                            <Check className="w-3 h-3" />
                                            {language === 'zh' ? '确认同步' : 'Sync Memory'}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="group/content relative py-2">
                                    <p className="text-[12.5px] text-text-secondary/90 leading-relaxed font-sans max-w-[95%]">
                                        {content}
                                    </p>

                                    {isAwaitingApproval && !isSuccess && (
                                        <motion.button
                                            whileHover={{ scale: 1.1, backgroundColor: 'rgba(255,255,255,0.1)' }}
                                            whileTap={{ scale: 0.9 }}
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                setIsEditing(true)
                                            }}
                                            className="absolute right-0 top-2 opacity-0 group-hover/content:opacity-100 p-2 rounded-full transition-all border border-white/5 bg-white/5"
                                        >
                                            <Edit2 className="w-3.5 h-3.5 text-accent" />
                                        </motion.button>
                                    )}

                                    {!isSuccess && isAwaitingApproval && (
                                        <div className="mt-4 flex items-center gap-2 opacity-40 group-hover/content:opacity-70 transition-opacity">
                                            <span className="w-1 h-1 rounded-full bg-accent" />
                                            <span className="text-[9px] text-text-muted uppercase tracking-widest font-bold">
                                                Waiting for project sync
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
