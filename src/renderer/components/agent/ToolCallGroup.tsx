/**
 * 工具调用组组件
 * 简化设计：聚焦当前，简化历史
 * 
 * - 正在执行的工具：独立显示，自动展开
 * - 已完成的工具：全部折叠到组中
 * - 用户可以展开折叠组查看历史
 */

import { useCallback, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ToolCall } from '@/renderer/agent/types'
import ToolCallCard from './ToolCallCard'
import FileChangeCard from './FileChangeCard'
import { MemoryApprovalInline } from './MemoryApprovalInline'
import { needsDiffPreview } from '@/shared/config/tools'
interface ToolCallGroupProps {
    toolCalls: ToolCall[]
    pendingToolId?: string
    onApproveTool?: () => void
    onRejectTool?: () => void
    onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
    messageId?: string
}

function ToolCallGroup({
    toolCalls,
    pendingToolId,
    onApproveTool,
    onRejectTool,
    onOpenDiff,
    messageId,
}: ToolCallGroupProps) {

    const renderToolCard = useCallback(
        (tc: ToolCall) => {
            const isPending = tc.id === pendingToolId

            // 需要 Diff 预览的工具使用 FileChangeCard
            if (needsDiffPreview(tc.name)) {
                return (
                    <FileChangeCard
                        key={tc.id}
                        toolCall={tc}
                        isAwaitingApproval={isPending}
                        onApprove={isPending ? onApproveTool : undefined}
                        onReject={isPending ? onRejectTool : undefined}
                        onOpenInEditor={onOpenDiff}
                        messageId={messageId}
                    />
                )
            }

            // AI 记忆提议使用极简内联渲染
            if (tc.name === 'remember') {
                return (
                    <MemoryApprovalInline
                        key={tc.id}
                        content={tc.arguments.content as string}
                        isAwaitingApproval={isPending}
                        isSuccess={tc.status === 'success'}
                        messageId={messageId || ''}
                        toolCallId={tc.id}
                        args={tc.arguments}
                    />
                )
            }

            // ask_user 由 InteractiveCard 独立渲染，跳过原始工具卡片
            if (tc.name === 'ask_user') {
                return null
            }

            // 其他工具使用 ToolCallCard
            return (
                <ToolCallCard
                    key={tc.id}
                    toolCall={tc}
                    isAwaitingApproval={isPending}
                    onApprove={isPending ? onApproveTool : undefined}
                    onReject={isPending ? onRejectTool : undefined}
                    defaultExpanded
                />
            )
        },
        [pendingToolId, onApproveTool, onRejectTool, onOpenDiff, messageId]
    )



    return (
        <div className="my-2 animate-slide-in-right space-y-2">
            <AnimatePresence initial={false}>
                {toolCalls.map(tc => (
                    <motion.div
                        key={tc.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                    >
                        {renderToolCard(tc)}
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    )
}

export default memo(ToolCallGroup)
