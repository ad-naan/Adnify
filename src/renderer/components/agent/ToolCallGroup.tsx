/**
 * 工具调用组组件
 * 简化设计：聚焦当前，简化历史
 *
 * - 正在执行的工具：独立显示，自动展开
 * - 已完成的工具：全部折叠到组中
 * - 用户可以展开折叠组查看历史
 */

import { memo } from 'react'
import type { ReactNode } from 'react'
import { ToolCall } from '@/renderer/agent/types'
import ToolCallCard from './ToolCallCard'
import FileChangeCard from './FileChangeCard'
import { MemoryApprovalInline } from './MemoryApprovalInline'
import { needsDiffPreview } from '@/shared/config/tools'

/**
 * 渲染单个工具调用卡片的统一入口。
 * 被 RenderPart（单个工具）和 ToolCallGroup（批量工具）共用，
 * 确保新增工具类型只需要改这一处。
 */
export function renderToolCallCard(
  tc: ToolCall,
  opts: {
    pendingToolId?: string
    onApproveTool?: () => void
    onRejectTool?: () => void
    onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
    messageId?: string
  },
): ReactNode {
  const isPending = tc.id === opts.pendingToolId

  // 需要 Diff 预览的工具使用 FileChangeCard
  if (needsDiffPreview(tc.name)) {
    return (
      <FileChangeCard
        key={tc.id}
        toolCall={tc}
        isAwaitingApproval={isPending}
        onApprove={isPending ? opts.onApproveTool : undefined}
        onReject={isPending ? opts.onRejectTool : undefined}
        onOpenInEditor={opts.onOpenDiff}
        messageId={opts.messageId}
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
        messageId={opts.messageId || ''}
        toolCallId={tc.id}
        args={tc.arguments}
      />
    )
  }

  // ask_user 由 InteractiveCard 独立渲染，跳过原始工具卡片
  if (tc.name === 'ask_user') {
    return null
  }

  // todo_write 通过底部 TodoListPanel 展示，不在聊天流中渲染卡片
  if (tc.name === 'todo_write') {
    return null
  }

  // 其他工具使用 ToolCallCard
  return (
    <ToolCallCard
      key={tc.id}
      toolCall={tc}
      isAwaitingApproval={isPending}
      onApprove={isPending ? opts.onApproveTool : undefined}
      onReject={isPending ? opts.onRejectTool : undefined}
    />
  )
}

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
  const opts = { pendingToolId, onApproveTool, onRejectTool, onOpenDiff, messageId }

  return (
    <div className="my-2 space-y-2">
      {toolCalls.map(tc => (
        <div key={tc.id}>
          {renderToolCallCard(tc, opts)}
        </div>
      ))}
    </div>
  )
}

export default memo(ToolCallGroup)
