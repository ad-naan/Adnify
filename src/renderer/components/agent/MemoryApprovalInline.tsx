import React from 'react'
import { ChevronDown, Brain } from 'lucide-react'
import { useStore } from '@store'
import { normalizeMemoryContentInput } from '@/renderer/agent/services/memoryService'
import { t } from '@shared/i18n'
import SmoothCollapse from './SmoothCollapse'
import { ToolDetailsView } from './ToolDetailsView'
import ToolActivityIndicator, { getToolTiming, ToolElapsedTime, TOOL_ROW_ACTION_SLOT_CLASS } from './ToolActivityIndicator'
import { useDisclosureState } from '@renderer/hooks'
import { AGENT_DISCLOSURE_HANDOFF_CLOSE_MS } from '@renderer/agent/presentation/disclosureMotion'
import type { ToolCall } from '@/renderer/agent/types'

interface MemoryApprovalInlineProps {
    toolCall: ToolCall
    isAwaitingApproval: boolean
    /** 这一行是不是时间轴当前呈现的阶段。 */
    isPresenting?: boolean
}

export const MemoryApprovalInline: React.FC<MemoryApprovalInlineProps> = ({
    toolCall,
    isAwaitingApproval,
    isPresenting,
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
        automaticOpen: isPresenting,
        openWhile: isAwaitingApproval || isRunning || isError,
        holdOpen: isPresenting,
        closeDelayMs: AGENT_DISCLOSURE_HANDOFF_CLOSE_MS,
    })

    const statusText = isSuccess
        ? (t('memoryApprovalInline.projectMemoryStored', language))
        : isError
            ? `${t('memoryApprovalInline.memoryProposal', language)} · ${t('common.failed', language)}`
        : (t('memoryApprovalInline.memoryProposal', language))

    return (
        <div className="group my-0.5 relative overflow-hidden">
            <button
                type="button"
                aria-expanded={isExpanded}
                className="flex min-h-9 w-full items-center gap-2 py-1.5 text-left cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
                onClick={toggleExpanded}
            >
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-text-muted/40 transition-transform duration-300 hover:text-text-muted motion-reduce:transition-none ${isExpanded ? 'rotate-0' : '-rotate-90'}`} />

                <ToolActivityIndicator state={activityState} />
                <Brain className="h-3.5 w-3.5 shrink-0 text-text-muted/55" />

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
                />

                {/* 占位，与文件修改行的操作图标共用同一条右边界。 */}
                <span className={TOOL_ROW_ACTION_SLOT_CLASS} aria-hidden="true" />
            </button>

            <SmoothCollapse open={isExpanded}>
                <div className="pl-[26px] pr-3 pb-3">
                    <ToolDetailsView args={Object.fromEntries(Object.entries(toolCall.arguments).filter(([key]) => !key.startsWith('_')))} response={toolCall.error || toolCall.result || safeContent} language={language} isError={isError}>
                        <div className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-text-secondary">
                            {safeContent || t('memoryApprovalInline.emptyMemoryContent', language)}
                            {toolCall.error && <p className="mt-2 text-status-error">{toolCall.error}</p>}
                        </div>
                    </ToolDetailsView>
                </div>
            </SmoothCollapse>
        </div>
    )
}
