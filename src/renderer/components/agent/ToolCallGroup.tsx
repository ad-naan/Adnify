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
import { normalizeMemoryContentInput } from '@/renderer/agent/services/memoryService'
import SubAgentTaskCard from './SubAgentTaskCard'
import { assessShellCommand } from '@shared/security/executionPolicy'

const NON_REUSABLE_APPROVAL_TOOLS = new Set([
  'delete_file_or_folder',
  'list_remote_directory',
  'read_remote_file',
  'write_remote_file',
  'rename_remote_path',
  'delete_remote_path',
  'upload_to_remote',
  'download_from_remote',
])

export function supportsTaskApproval(toolCall: ToolCall): boolean {
  if (NON_REUSABLE_APPROVAL_TOOLS.has(toolCall.name)) return false
  if (toolCall.name === 'run_command') {
    if (toolCall.arguments.server_name) return false
    const command = typeof toolCall.arguments.command === 'string' ? toolCall.arguments.command : ''
    const decision = assessShellCommand(command, [])
    return decision.kind !== 'deny' && decision.risk !== 'dangerous'
  }
  return typeof toolCall.arguments.path === 'string'
}

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
    onApproveToolForTask?: () => void
    onRejectTool?: () => void
    onStopTool?: () => void
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
        onApproveForTask={isPending && supportsTaskApproval(tc) ? opts.onApproveToolForTask : undefined}
        onReject={isPending ? opts.onRejectTool : undefined}
        onStop={isPending ? opts.onStopTool : undefined}
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
        content={normalizeMemoryContentInput(tc.arguments.content)}
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

  if (tc.name === 'task') {
    return <SubAgentTaskCard key={tc.id} toolCall={tc} />
  }

  // 其他工具使用 ToolCallCard
  return (
    <ToolCallCard
      key={tc.id}
      toolCall={tc}
      isAwaitingApproval={isPending}
      onApprove={isPending ? opts.onApproveTool : undefined}
      onApproveForTask={isPending && supportsTaskApproval(tc) ? opts.onApproveToolForTask : undefined}
      onReject={isPending ? opts.onRejectTool : undefined}
      onStop={isPending ? opts.onStopTool : undefined}
    />
  )
}

interface ToolCallGroupProps {
  toolCalls: ToolCall[]
  pendingToolId?: string
  onApproveTool?: () => void
  onApproveToolForTask?: () => void
  onRejectTool?: () => void
  onStopTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
  messageId?: string
}

function ToolCallGroup({
  toolCalls,
  pendingToolId,
  onApproveTool,
  onApproveToolForTask,
  onRejectTool,
  onStopTool,
  onOpenDiff,
  messageId,
}: ToolCallGroupProps) {
  const opts = { pendingToolId, onApproveTool, onApproveToolForTask, onRejectTool, onStopTool, onOpenDiff, messageId }

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
