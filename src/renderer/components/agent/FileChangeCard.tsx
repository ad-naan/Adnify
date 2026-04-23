import { useState, useEffect, useMemo, memo } from 'react'
import { Check, X, ChevronDown, ExternalLink } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { ToolCall } from '@renderer/agent/types'
import { useToolDisplayState } from '@renderer/agent/presentation/toolDisplay'
import { streamingEditService } from '@renderer/agent/services/streamingEditService'
import { resolveStreamingEditFilePath } from '@renderer/agent/services/streamingEditPreview'
import { useToolCardExpansion } from '@renderer/hooks'
import InlineDiffPreview, { getApproxLineDeltaStats, getDiffStats } from './InlineDiffPreview'
import { getFileName, joinPath } from '@shared/utils/pathUtils'
import { ExpandablePreviewContainer } from './ToolCallCard'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { api } from '@/renderer/services/electronAPI'
import { toast } from '@components/common/ToastProvider'

interface FileChangeCardProps {
    toolCall: ToolCall
    isAwaitingApproval?: boolean
    onApprove?: () => void
    onReject?: () => void
    onOpenInEditor?: (path: string, oldContent: string, newContent: string) => void
    messageId?: string
}

function FileChangeCard({
    toolCall,
    isAwaitingApproval,
    onApprove,
    onReject,
    onOpenInEditor,
}: FileChangeCardProps) {
    const { openFile, setActiveFile, workspacePath, language } = useStore(useShallow(s => ({
        openFile: s.openFile,
        setActiveFile: s.setActiveFile,
        workspacePath: s.workspacePath,
        language: s.language
    })))
    const { args, isSuccess, isError, isRunning, isStreaming } = useToolDisplayState(toolCall)
    const isActive = isRunning || isStreaming
    const { isExpanded, animateContent, handleToggleExpanded } = useToolCardExpansion({
        defaultExpanded: true,
        isActive,
    })

    const meta = args._meta as Record<string, unknown> | undefined
    const filePath = (args.path || meta?.filePath) as string || ''
    const resolvedStreamingFilePath = useMemo(() => {
        return resolveStreamingEditFilePath(filePath, workspacePath) || ''
    }, [filePath, workspacePath])
    const isLargeWrite = meta?.isLargeWrite === true || meta?.contentTruncated === true

    // Local streamed content used by the diff preview.
    const [streamingContent, setStreamingContent] = useState<string | null>(null)

    // Subscribe only to this file path instead of all active edits.
    useEffect(() => {
        if (!isRunning && !isStreaming) {
            setStreamingContent(null)
            return
        }

        const editState = streamingEditService.getEditByFilePath(resolvedStreamingFilePath)
        if (editState) {
            setStreamingContent(editState.currentContent)
        }

        const unsubscribe = streamingEditService.subscribeByFilePath(resolvedStreamingFilePath, state => {
            setStreamingContent(state?.currentContent ?? null)
        })

        return unsubscribe
    }, [resolvedStreamingFilePath, isRunning, isStreaming])

    // Build old content for diffing.
    const oldContent = useMemo(() => {
        if (meta?.oldContent !== undefined) {
            return meta.oldContent as string
        }

        // For streamed edits, old_string is the best local base.
        if ((isRunning || isStreaming) && args.old_string) {
            return args.old_string as string
        }

        // Hide unrelated old-content noise while partial edits are still streaming.
        if ((isRunning || isStreaming) && !meta?.oldContent && !args.old_string) {
            const isPartialEdit = toolCall.name === 'edit_file'
            if (isPartialEdit) return ''
        }

        return ''
    }, [meta, args.old_string, isRunning, isStreaming, toolCall.name])

    const newContent = useMemo(() => {
        // Prefer live streamed content while the tool is active.
        if (streamingContent && (isRunning || isStreaming)) {
            return streamingContent
        }
        if (meta?.newContent) return meta.newContent as string
        return (args.content || args.code || args.new_string || args.replacement || args.source) as string || ''
    }, [args, meta, streamingContent, isRunning, isStreaming])

    const openFullFile = useMemo(() => async () => {
        let absPath = filePath
        const isAbsolute = /^([a-zA-Z]:[\\/]|[/])/.test(absPath)
        if (!isAbsolute && workspacePath) {
            absPath = joinPath(workspacePath, absPath)
        }

        try {
            const content = await api.file.read(absPath)
            if (content !== null) {
                openFile(absPath, content)
                setActiveFile(absPath)
                return
            }
        } catch {
            // Best effort fallback below.
        }

        toast.error(`Failed to open file: ${getFileName(absPath)}`)
    }, [filePath, workspacePath, openFile, setActiveFile])

    const diffStats = useMemo(() => {
        // Prefer precise stats returned by the tool when available.
        if (meta?.linesAdded !== undefined || meta?.linesRemoved !== undefined) {
            return {
                added: (meta.linesAdded as number) || 0,
                removed: (meta.linesRemoved as number) || 0
            }
        }
        if (!newContent) return { added: 0, removed: 0 }
        if (isRunning || isStreaming) {
            return getApproxLineDeltaStats(oldContent, newContent)
        }
        try {
            return getDiffStats(oldContent, newContent)
        } catch {
            return { added: 0, removed: 0 }
        }
    }, [oldContent, newContent, meta, isRunning, isStreaming])

    const isNewFile = ['create_file', 'create_file_or_folder'].includes(toolCall.name) ||
        (!oldContent && !!newContent && !['edit_file', 'replace_file_content', 'write_file'].includes(toolCall.name))
    // Card style only; visual design remains unchanged.
    const cardStyle = useMemo(() => {
        if (isAwaitingApproval) return 'border-l-2 border-yellow-500 bg-yellow-500/5'
        if (isError) return 'bg-red-500/5'
        if (isStreaming || isRunning) return 'bg-accent/5'
        return 'hover:bg-text-primary/[0.02] transition-colors rounded-lg'
    }, [isAwaitingApproval, isError, isStreaming, isRunning])

    const contentBody = (
        <div className="pl-[26px] pr-3 pb-3 pt-0 relative">
            <div className="absolute left-[13.5px] top-0 bottom-4 w-[1.5px] bg-border/40 rounded-full" />

            <div className="relative z-10">
                <ExpandablePreviewContainer language={language}>
                    <div className="relative min-h-[60px] p-2">
                        {isLargeWrite && !isStreaming && !isRunning ? (
                            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] text-text-secondary">
                                <div className="font-medium text-amber-400">
                                    Large file preview is deferred to keep the UI responsive.
                                </div>
                                <div className="mt-1 opacity-80">
                                    {typeof meta?.oldContentLength === 'number' || typeof meta?.newContentLength === 'number'
                                        ? `Size: ${meta?.oldContentLength || 0} -> ${meta?.newContentLength || 0} chars`
                                        : 'Open the file in the editor to inspect the full result.'}
                                </div>
                                <div className="mt-3">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            void openFullFile()
                                        }}
                                        className="rounded-md border border-border bg-surface-hover px-2.5 py-1.5 text-[11px] font-medium text-text-primary transition-colors hover:border-accent hover:text-accent"
                                    >
                                        Open full file
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <InlineDiffPreview
                                oldContent={oldContent}
                                newContent={newContent}
                                filePath={filePath}
                                isStreaming={isActive}
                                maxLines={50}
                            />
                        )}
                    </div>
                </ExpandablePreviewContainer>
            </div>
        </div>
    )

    return (
        <div
            className={`group my-0.5 relative ${cardStyle} overflow-hidden`}
        >
            {/* ToolCall Card Background Sweeping Effect */}
            {(isStreaming || isRunning) && (
                <div className="absolute inset-0 pointer-events-none rounded-lg overflow-hidden">
                    <div className="absolute inset-0 w-[200%] h-full bg-gradient-to-r from-transparent via-accent/10 to-transparent animate-shimmer" />
                </div>
            )}
            {/* Header - Flat Outline Style */}
            <div
                className="flex min-h-[32px] items-center gap-2 py-1.5 cursor-pointer select-none"
                onClick={handleToggleExpanded}
            >
                {/* Expand Toggle (Moved to far left) */}
                <motion.div
                    animate={{ rotate: isExpanded ? 90 : 0 }}
                    transition={{ duration: 0.15 }}
                    className="shrink-0 text-text-muted/40 hover:text-text-muted transition-colors"
                >
                    <ChevronDown className="w-3.5 h-3.5 -rotate-90" />
                </motion.div>

                {/* Status Icon */}
                <div className="shrink-0 relative z-10 w-4 h-4 flex items-center justify-center">
                    {isStreaming || isRunning ? (
                        <div className="w-3.5 h-3.5 rounded-full bg-accent/20 flex items-center justify-center border border-accent/30">
                            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                        </div>
                    ) : isSuccess ? (
                        <div className="w-3.5 h-3.5 rounded-full bg-green-500/10 flex items-center justify-center">
                            <Check className="w-2.5 h-2.5 text-green-500" />
                        </div>
                    ) : isError ? (
                        <div className="w-3.5 h-3.5 rounded-full bg-red-500/10 flex items-center justify-center">
                            <X className="w-2.5 h-2.5 text-red-500" />
                        </div>
                    ) : (
                        <div className="w-3.5 h-3.5 rounded-full border border-text-muted/30" />
                    )}
                </div>

                {/* File Info */}
                <div className="flex-1 min-w-0 flex items-center justify-between relative z-10">
                    <div className="flex items-center gap-2 truncate">
                        {filePath ? (
                            <div className="flex items-center gap-2">
                                <span
                                    className={`text-[12px] truncate transition-colors ${isStreaming || isRunning ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'}`}
                                >
                                    {isNewFile ? 'Create ' : 'Update '}
                                </span>
                                <span
                                    className={`${isNewFile ? 'text-status-success' : 'text-text-primary'} ${isStreaming || isRunning ? 'text-shimmer text-[12px] font-medium' : 'font-medium text-[12px]'} hover:underline hover:text-accent cursor-pointer transition-colors break-all`}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        if (isLargeWrite) {
                                            void openFullFile()
                                        } else if (onOpenInEditor && newContent) {
                                            onOpenInEditor(filePath, oldContent, newContent)
                                        } else {
                                            let absPath = filePath
                                            const isAbsolute = /^([a-zA-Z]:[\\/]|[/])/.test(absPath)
                                            if (!isAbsolute && workspacePath) {
                                                absPath = joinPath(workspacePath, absPath)
                                            }

                                            api.file.read(absPath).then(content => {
                                                if (content !== null) {
                                                    const diffUri = `diff://${absPath}`
                                                    openFile(diffUri, newContent, oldContent)
                                                    setActiveFile(diffUri)
                                                } else {
                                                    toast.error(`Failed to open file: ${getFileName(absPath)}`)
                                                }
                                            }).catch(() => {
                                                toast.error(`Failed to open file: ${getFileName(absPath)}`)
                                            })
                                        }
                                    }}
                                    title={filePath}
                                >
                                    {getFileName(filePath)}
                                </span>
                            </div>
                        ) : (isStreaming || isRunning) ? (
                            <span className="font-medium text-[11px] italic text-shimmer">editing...</span>
                        ) : (
                            <span className="font-medium text-[11px] text-text-primary opacity-50">&lt;empty path&gt;</span>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        {(isSuccess || newContent) && (
                            <span className="text-[10px] font-mono opacity-60 flex items-center gap-1.5 px-1.5 py-0.5 bg-text-primary/[0.05] rounded border border-border">
                                {diffStats.added > 0 && (
                                    <span className="text-green-400">+{diffStats.added}</span>
                                )}
                                {diffStats.removed > 0 && (
                                    <span className="text-red-400">-{diffStats.removed}</span>
                                )}
                                {isNewFile && diffStats.added === 0 && (
                                    <span className="text-blue-400">new</span>
                                )}
                            </span>
                        )}
                        {isSuccess && onOpenInEditor && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation()
                                    if (isLargeWrite) {
                                        void openFullFile()
                                        return
                                    }
                                    onOpenInEditor(filePath, oldContent, newContent)
                                }}
                                className="p-1 text-text-muted hover:text-accent hover:bg-surface-hover rounded-md transition-colors opacity-0 group-hover:opacity-100"
                                title="Open in Editor"
                            >
                                <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Expanded Content */}
            {isExpanded && newContent && (
                animateContent ? (
                    <AnimatePresence initial={false}>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.16, ease: 'easeOut' }}
                        >
                            {contentBody}
                        </motion.div>
                    </AnimatePresence>
                ) : (
                    contentBody
                )
            )}

            {/* Error Message */}
            {toolCall.error && isExpanded && (
                <div className="px-3 pb-3 pl-9">
                    <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-md">
                        <p className="text-[11px] text-red-300 font-mono break-all">{toolCall.error}</p>
                    </div>
                </div>
            )}

            {/* Approval Actions */}
            {isAwaitingApproval && (
                <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-yellow-500/10 bg-yellow-500/5">
                    <button
                        onClick={onReject}
                        className="px-3 py-1.5 text-xs font-medium text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all active:scale-95"
                    >
                        Reject
                    </button>
                    <button
                        onClick={onApprove}
                        className="px-3 py-1.5 text-xs font-medium bg-accent text-white hover:bg-accent-hover rounded-md transition-all shadow-sm shadow-accent/20 active:scale-95 hover:shadow-accent/40"
                    >
                        Accept
                    </button>
                </div>
            )}
        </div>
    )
}

export default memo(FileChangeCard)
