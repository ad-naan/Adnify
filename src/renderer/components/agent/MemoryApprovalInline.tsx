import React from 'react'
import { ChevronDown, Brain } from 'lucide-react'
import { useStore } from '@store'
import { normalizeMemoryContentInput } from '@/renderer/agent/services/memoryService'
import { t } from '@shared/i18n'
import SmoothCollapse from './SmoothCollapse'
import ToolActivityIndicator, { getToolTiming, ToolElapsedTime } from './ToolActivityIndicator'
import { useDisclosureState } from '@renderer/hooks'
import type { ToolCall } from '@/renderer/agent/types'

interface MemoryApprovalInlineProps {
    toolCall: ToolCall
    isAwaitingApproval: boolean
    presentOnMount?: boolean
}

export const MemoryApprovalInline: React.FC<MemoryApprovalInlineProps> = ({
    toolCall,
    isAwaitingApproval,
    presentOnMount,
}) => {
    const language = useStore(s => s.language)
    const safeContent = normalizeMemoryContentInput(toolCall.arguments.content)
    const status = toolCall.status
    const isSuccess = status === 'success'
    const isError = status === 'error' || status === 'rejected'
    const isRunning = status === 'pending' || status === 'running' || status === 'awaiting'
    const activityState = isRunning ? 'running' : isSuccess ? 'success' : isError ? 'error' : 'idle'
    const timing = getToolTiming(toolCall)
    const { isOpen: isExpanded, toggle: toggleExpanded } = useDisclosureState({
        openWhile: isAwaitingApproval || isRunning || isError,
        presentOnMount,
    })

    const statusText = isSuccess
        ? (t('memoryApprovalInline.projectMemoryStored', language))
        : isError
            ? `${t('memoryApprovalInline.memoryProposal', language)} · ${t('common.failed', language)}`
        : (t('memoryApprovalInline.memoryProposal', language))

    return (
        <div className="group my-0.5 relative hover:bg-text-primary/[0.02] transition-colors rounded-lg overflow-hidden">
            <div
                className="flex items-center gap-2 py-1.5 cursor-pointer select-none"
                onClick={toggleExpanded}
            >
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-text-muted/40 transition-transform duration-300 hover:text-text-muted motion-reduce:transition-none ${isExpanded ? 'rotate-0' : '-rotate-90'}`} />

                <div className="shrink-0 relative z-10 w-4 h-4 flex items-center justify-center">
                    {isAwaitingApproval ? (
                        <div className="w-3.5 h-3.5 rounded-full bg-purple-500/10 flex items-center justify-center">
                            <Brain className="w-2.5 h-2.5 text-purple-400" />
                        </div>
                    ) : (
                        <ToolActivityIndicator state={activityState} startedAt={timing.startedAt} />
                    )}
                </div>

                <div className="flex-1 min-w-0 flex items-center gap-2 overflow-hidden relative z-10">
                    <span className={`text-[12px] truncate ${isRunning ? 'text-text-primary tool-text-shimmer' : 'text-text-secondary group-hover:text-text-primary transition-colors'}`}>
                        {statusText}
                    </span>
                    {!isExpanded && safeContent && (
                        <span className="text-[11px] text-text-muted/40 truncate">
                            - {safeContent.slice(0, 50)}{safeContent.length > 50 ? '...' : ''}
                        </span>
                    )}
                </div>
                <ToolElapsedTime
                    state={activityState}
                    startedAt={timing.startedAt}
                    durationMs={timing.durationMs}
                    className="mr-1"
                />
            </div>

            <SmoothCollapse open={isExpanded}>
                        <div className="pl-[26px] pr-3 pb-3 pt-0 relative border-t-0">
                            <div className="absolute left-[13.5px] top-0 bottom-4 w-[1.5px] bg-border/40 rounded-full" />

                            <div className="relative z-10 mt-1">
                                <div className="text-[11px] text-text-secondary/80 leading-relaxed font-sans whitespace-pre-wrap border-l-2 border-border/30 pl-2 ml-1">
                                    {safeContent || (t('memoryApprovalInline.emptyMemoryContent', language))}
                                </div>
                            </div>
                        </div>
            </SmoothCollapse>
        </div>
    )
}
