import { useState, useEffect, useMemo, memo } from 'react'
import { ChevronDown, ExternalLink, FilePenLine } from 'lucide-react'
import { ToolCall } from '@renderer/agent/types'
import { useToolDisplayState } from '@renderer/agent/presentation/toolDisplay'
import { streamingEditService } from '@renderer/agent/services/streamingEditService'
import { resolveStreamingEditFilePath } from '@renderer/agent/services/streamingEditPreview'
import { useDisclosureState } from '@renderer/hooks'
import { AGENT_DISCLOSURE_HANDOFF_CLOSE_MS } from '@renderer/agent/presentation/disclosureMotion'
import InlineDiffPreview, { getApproxLineDeltaStats, getDiffStats } from './InlineDiffPreview'
import { getFileName, joinPath } from '@shared/utils/pathUtils'
import { ExpandablePreviewContainer } from './ToolCallCard'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { api } from '@/renderer/services/electronAPI'
import { toast } from '@components/common/ToastProvider'
import { isCreateActionLabel, resolveFileChangeActionLabel } from '@renderer/agent/utils/fileWriteDisplay'
import { RollingNumber } from '@components/ui'
import { ToolApprovalActions } from './ToolApprovalActions'
import { safeOpenFile } from '@renderer/utils/fileUtils'
import SmoothCollapse from './SmoothCollapse'
import ToolActivityIndicator, { getToolTiming, ToolElapsedTime, TOOL_ROW_ACTION_SLOT_CLASS } from './ToolActivityIndicator'
import { t } from '@shared/i18n'

interface FileChangeCardProps {
    toolCall: ToolCall
    isAwaitingApproval?: boolean
    onApprove?: () => void
    onApproveForTask?: () => void
    onReject?: () => void
    onStop?: () => void
    onOpenInEditor?: (path: string, oldContent: string, newContent: string) => void
    messageId?: string
    /** 这一行是不是时间轴当前呈现的阶段。落下的那一刻就是后继行挂载的那一刻。 */
    isPresenting?: boolean
}

function FileChangeCard({
    toolCall,
    isAwaitingApproval,
    onApprove,
    onApproveForTask,
    onReject,
    onStop,
    onOpenInEditor,
    isPresenting,
}: FileChangeCardProps) {
    const { openFile, setActiveFile, workspacePath, language } = useStore(useShallow(s => ({
        openFile: s.openFile,
        setActiveFile: s.setActiveFile,
        workspacePath: s.workspacePath,
        language: s.language,
    })))
    const { args, isSuccess, isError, isRunning, isStreaming } = useToolDisplayState(toolCall)
    const isActive = isRunning || isStreaming
    const { isOpen: isExpanded, toggle: handleToggleExpanded } = useDisclosureState({
        automaticOpen: isPresenting,
        openWhile: isActive || Boolean(isAwaitingApproval) || isError,
        holdOpen: isPresenting,
        closeDelayMs: AGENT_DISCLOSURE_HANDOFF_CLOSE_MS,
    })
    const timing = getToolTiming(toolCall)
    const activityState = isStreaming || isRunning
        ? 'running'
        : isSuccess
            ? 'success'
            : isError
                ? 'error'
                : 'idle'

    const meta = args._meta as Record<string, unknown> | undefined
    const filePath = (args.path || args.relative_path || meta?.filePath) as string || ''
    const resolvedStreamingFilePath = useMemo(() => {
        return resolveStreamingEditFilePath(filePath, workspacePath) || ''
    }, [filePath, workspacePath])
    const isLargeWrite = meta?.isLargeWrite === true || meta?.contentTruncated === true

    // Local streamed content used by the diff preview.
    const [streamingContent, setStreamingContent] = useState<string | null>(null)
    const [streamingOriginalContent, setStreamingOriginalContent] = useState<string | null>(null)

    // Subscribe only to this file path instead of all active edits.
    useEffect(() => {
        if (!isRunning && !isStreaming) {
            setStreamingContent(null)
            setStreamingOriginalContent(null)
            return
        }

        const editState = streamingEditService.getEditByFilePath(resolvedStreamingFilePath)
        if (editState) {
            setStreamingContent(editState.currentContent)
            setStreamingOriginalContent(editState.originalContent)
        }

        const unsubscribe = streamingEditService.subscribeByFilePath(resolvedStreamingFilePath, state => {
            setStreamingContent(state?.currentContent ?? null)
            setStreamingOriginalContent(state?.originalContent ?? null)
        })

        return unsubscribe
    }, [resolvedStreamingFilePath, isRunning, isStreaming])

    // Build old content for diffing.
    const oldContent = useMemo(() => {
        if (meta?.oldContent !== undefined) {
            return meta.oldContent as string
        }

        // Prefer live streamed original content while the tool is active.
        if (streamingOriginalContent && (isRunning || isStreaming)) {
            return streamingOriginalContent
        }

        // For streamed edits, old_string is the best local base.
        if ((isRunning || isStreaming) && args.old_string) {
            return args.old_string as string
        }

        // Hide unrelated old-content noise while partial edits are still streaming.
        if ((isRunning || isStreaming) && !meta?.oldContent && !args.old_string) {
            const isPartialEdit = toolCall.name === 'edit_file' || toolCall.name === 'edit_symbol'
            if (isPartialEdit) return ''
        }

        return ''
    }, [meta, args.old_string, isRunning, isStreaming, toolCall.name, streamingOriginalContent])

    const newContent = useMemo(() => {
        // Prefer live streamed content while the tool is active.
        if (streamingContent && (isRunning || isStreaming)) {
            return streamingContent
        }
        if (meta?.newContent) return meta.newContent as string
        return (args.content || args.code || args.new_string || args.replacement || args.source || args.body || args.new_name) as string || ''
    }, [args, meta, streamingContent, isRunning, isStreaming])

    const openFullFile = useMemo(() => async () => {
        let absPath = filePath
        const isAbsolute = /^([a-zA-Z]:[\\/]|[/])/.test(absPath)
        if (!isAbsolute && workspacePath) {
            absPath = joinPath(workspacePath, absPath)
        }

        try {
            const result = await safeOpenFile(absPath, { language, confirmLargeFile: false })
            if (result.success) {
                return
            }
        } catch {
            // Best effort fallback below.
        }

        toast.error(`Failed to open file: ${getFileName(absPath)}`)
    }, [filePath, workspacePath, language])

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

    const changeLabel = useMemo(() => (
        resolveFileChangeActionLabel(toolCall.name, meta, oldContent, newContent)
    ), [toolCall.name, meta, oldContent, newContent])
    const isCreateAction = isCreateActionLabel(changeLabel)
    // Card style only; visual design remains unchanged.
    const cardStyle = useMemo(() => {
        if (isAwaitingApproval) return 'border-l-2 border-yellow-500 bg-yellow-500/5'
        if (isError) return 'bg-red-500/5'
        if (isStreaming || isRunning) return 'bg-accent/[0.035]'
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
            {/* Header - Flat Outline Style */}
            <div
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded}
                className="relative flex min-h-9 w-full cursor-pointer select-none items-center gap-2 rounded-lg py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
                onClick={handleToggleExpanded}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        handleToggleExpanded()
                    }
                }}
            >
                {/* Expand Toggle (Moved to far left) */}
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-text-muted/40 transition-transform duration-300 group-hover:text-text-muted motion-reduce:transition-none ${isExpanded ? 'rotate-0' : '-rotate-90'}`} />

                {/* Status Icon */}
                <ToolActivityIndicator
                    state={activityState}
                />
                <FilePenLine className="h-3.5 w-3.5 shrink-0 text-text-muted/55" aria-hidden="true" />

                {/* File Info */}
                <div className="flex-1 min-w-0 flex items-center justify-between relative z-10">
                    <div className="flex items-center gap-2 truncate">
                        {filePath ? (
                            <div className="flex items-center gap-2">
                                <span
                                    className={`text-[12px] truncate transition-colors ${isStreaming || isRunning ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'}`}
                                >
                                    {changeLabel}{' '}
                                </span>
                                <span
                                    className={`${isCreateAction ? 'text-status-success' : 'text-text-primary'} ${isStreaming || isRunning ? 'tool-text-shimmer text-[12px] font-medium' : 'font-medium text-[12px]'} hover:underline hover:text-accent cursor-pointer transition-colors break-all`}
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

                                            api.file.readFull(absPath).then(content => {
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
                            <span className="font-medium text-[11px] italic tool-text-shimmer">editing...</span>
                        ) : (
                            <span className="font-medium text-[11px] text-text-primary opacity-50">&lt;empty path&gt;</span>
                        )}
                    </div>

                    {/* 行尾顺序：增删统计 → 耗时 → 操作图标，让耗时与其他工具行的右边界对齐。 */}
                    <div className="flex shrink-0 items-center gap-2">
                        {(isSuccess || newContent) && (
                            <span className="text-[10px] font-mono opacity-80 flex items-center gap-2 px-1.5 py-0.5 bg-text-primary/[0.03] rounded border border-border/50 backdrop-blur-sm shadow-sm select-none">
                                {diffStats.added > 0 && (
                                    <span className="flex items-center gap-0.5 text-green-400 font-semibold">
                                        <span>+</span>
                                        <RollingNumber value={diffStats.added} className="text-green-400" />
                                    </span>
                                )}
                                {diffStats.removed > 0 && (
                                    <span className="flex items-center gap-0.5 text-red-400 font-semibold">
                                        <span>-</span>
                                        <RollingNumber value={diffStats.removed} className="text-red-400" />
                                    </span>
                                )}
                                {isCreateAction && diffStats.added === 0 && (
                                    <span className="text-blue-400 font-semibold">new</span>
                                )}
                            </span>
                        )}
                        <ToolElapsedTime
                            state={activityState}
                            startedAt={timing.startedAt}
                            durationMs={timing.durationMs}
                        />
                        {/* 行尾操作位：图标常驻（弱显示），非成功态也保留占位，
                            避免耗时/统计的右边界随状态跳动而看起来没对齐。 */}
                        {onOpenInEditor && (
                            <span className={`flex items-center justify-center ${TOOL_ROW_ACTION_SLOT_CLASS}`}>
                                {isSuccess && (
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            if (isLargeWrite) {
                                                void openFullFile()
                                                return
                                            }
                                            onOpenInEditor(filePath, oldContent, newContent)
                                        }}
                                        className={`flex items-center justify-center rounded-md text-text-muted opacity-55 transition-all hover:bg-surface-hover hover:text-accent group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/40 ${TOOL_ROW_ACTION_SLOT_CLASS}`}
                                        title={t('fileChangeCard.openInEditor', language)}
                                    >
                                        <ExternalLink className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Expanded Content */}
            {(newContent || isActive || isLargeWrite) && (
                <SmoothCollapse open={isExpanded}>{contentBody}</SmoothCollapse>
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
                <div className="border-t border-yellow-500/10 bg-yellow-500/5 px-3 py-2">
                    <ToolApprovalActions
                        language={language}
                        onApprove={onApprove}
                        onApproveForTask={onApproveForTask}
                        onReject={onReject}
                        onStop={onStop}
                    />
                </div>
            )}
        </div>
    )
}

export default memo(FileChangeCard)
