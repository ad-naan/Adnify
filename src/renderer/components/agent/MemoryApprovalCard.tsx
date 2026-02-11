import React, { useState, useEffect } from 'react'
import { Brain, Edit2, Check, Sparkles, MessageSquare } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface MemoryApprovalCardProps {
    content: string
    isAwaitingApproval: boolean
    isSuccess?: boolean
    onUpdateContent?: (newContent: string) => void
}

export const MemoryApprovalCard: React.FC<MemoryApprovalCardProps> = ({
    content,
    isAwaitingApproval,
    isSuccess,
    onUpdateContent
}) => {
    const [isEditing, setIsEditing] = useState(false)
    const [editedContent, setEditedContent] = useState(content)

    // 同步外部 content 变化（如果是流式输出虽然 remember 不太可能流式，但为了鲁棒性）
    useEffect(() => {
        if (!isEditing) {
            setEditedContent(content)
        }
    }, [content, isEditing])

    const handleSave = () => {
        if (onUpdateContent) {
            onUpdateContent(editedContent)
        }
        setIsEditing(false)
    }

    const handleCancel = () => {
        setEditedContent(content)
        setIsEditing(false)
    }

    return (
        <div className="relative group/memory my-2 overflow-hidden rounded-2xl border border-accent/20 bg-background-tertiary/40 backdrop-blur-xl shadow-2xl">
            {/* 炫彩渐变背景装饰 */}
            <div className="absolute -top-10 -right-10 w-32 h-32 bg-accent/10 rounded-full blur-3xl group-hover/memory:bg-accent/20 transition-all duration-700" />
            <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl" />

            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-accent/10 to-transparent border-b border-white/5">
                <div className="relative">
                    <div className="absolute inset-0 bg-accent/40 rounded-full blur-md animate-pulse" />
                    <div className="relative w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center border border-accent/40 shadow-[0_0_15px_rgba(var(--accent-rgb),0.3)]">
                        <Brain className="w-4 h-4 text-accent" />
                    </div>
                </div>
                <div className="flex-1">
                    <h4 className="text-[13px] font-bold text-text-primary flex items-center gap-1.5 tracking-tight">
                        {isSuccess ? 'Memory Stored' : 'AI Memory Proposal'}
                        {isAwaitingApproval && (
                            <motion.span
                                animate={{ opacity: [0.4, 1, 0.4] }}
                                transition={{ repeat: Infinity, duration: 2 }}
                                className="inline-block"
                            >
                                <Sparkles className="w-3 h-3 text-amber-400" />
                            </motion.span>
                        )}
                    </h4>
                    <p className="text-[10px] text-text-muted font-medium opacity-70">
                        {isSuccess ? 'This fact is now part of project knowledge' : 'AI found an important project fact to remember'}
                    </p>
                </div>
            </div>

            {/* Content Area */}
            <div className="p-4 relative">
                <AnimatePresence mode="wait">
                    {isEditing ? (
                        <motion.div
                            key="editing"
                            initial={{ opacity: 0, scale: 0.98 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.98 }}
                            className="space-y-3"
                        >
                            <textarea
                                value={editedContent}
                                onChange={(e) => setEditedContent(e.target.value)}
                                className="w-full h-24 p-3 bg-black/40 rounded-xl border border-accent/30 text-xs text-text-primary focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all resize-none font-sans leading-relaxed shadow-inner"
                                autoFocus
                                placeholder="Refine the memory content..."
                            />
                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={handleCancel}
                                    className="px-3 py-1.5 text-[11px] font-medium text-text-muted hover:text-text-primary hover:bg-white/5 rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSave}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold bg-accent text-white rounded-lg shadow-lg shadow-accent/20 hover:bg-accent-hover transition-all"
                                >
                                    <Check className="w-3 h-3" />
                                    Confirm Change
                                </button>
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="display"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="flex items-start gap-3"
                        >
                            <div className="mt-1 p-1 rounded-md bg-white/5 border border-white/5 opacity-50">
                                <MessageSquare className="w-3 h-3 text-text-muted" />
                            </div>
                            <div className="flex-1 group/text">
                                <p className="text-xs text-text-secondary leading-relaxed font-sans italic">
                                    "{content}"
                                </p>
                                {isAwaitingApproval && (
                                    <button
                                        onClick={() => setIsEditing(true)}
                                        className="mt-2 flex items-center gap-1.5 text-[10px] text-accent/60 hover:text-accent font-bold opacity-0 group-hover/text:opacity-100 transition-all transform translate-y-1 group-hover/text:translate-y-0"
                                    >
                                        <Edit2 className="w-2.5 h-2.5" />
                                        Refine Proposal
                                    </button>
                                )}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Bottom Glow */}
            <div className={`h-1 w-full bg-gradient-to-r ${isSuccess ? 'from-green-500/50 to-green-500/10' : 'from-accent/50 to-accent/10'} opacity-30`} />
        </div>
    )
}
