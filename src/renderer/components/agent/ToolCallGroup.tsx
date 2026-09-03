/**
 * Groups adjacent tool rows and applies the timeline-owned entrance stage. Each
 * specialized card still owns only its explicit automatic/manual disclosure.
 */

import { memo } from 'react'
import type { ReactNode } from 'react'
import { ToolCall } from '@/renderer/agent/types'
import ToolCallCard from './ToolCallCard'
import FileChangeCard from './FileChangeCard'
import { MemoryApprovalInline } from './MemoryApprovalInline'
import { needsDiffPreview } from '@/shared/config/tools'
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
    presentOnMount?: boolean
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
        presentOnMount={opts.presentOnMount}
      />
    )
  }

  // AI 记忆提议使用极简内联渲染
  if (tc.name === 'remember') {
    return (
      <MemoryApprovalInline
        key={tc.id}
        toolCall={tc}
        isAwaitingApproval={isPending}
        presentOnMount={opts.presentOnMount}
      />
    )
  }

  // ask_user 由 InteractiveCard 独立渲染，跳过原始工具卡片
  if (tc.name === 'ask_user') {
    return null
  }

  // todo_write is represented by the unified status tray, not a timeline card.
  if (tc.name === 'todo_write') {
    return null
  }

  if (tc.name === 'task') {
    return <SubAgentTaskCard key={tc.id} toolCall={tc} messageId={opts.messageId} presentOnMount={opts.presentOnMount} />
  }

  // 其他工具使用 ToolCallCard
  return (
    <ToolCallCard
      key={tc.id}
      toolCall={tc}
      isAwaitingApproval={isPending}
      presentOnMount={opts.presentOnMount}
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
  presentingToolId?: string
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
  presentingToolId,
}: ToolCallGroupProps) {
  const opts = { pendingToolId, onApproveTool, onApproveToolForTask, onRejectTool, onStopTool, onOpenDiff, messageId }

  return (
    <div className="my-2 space-y-2">
      {toolCalls.map(tc => (
        <div key={tc.id} className={tc.id === presentingToolId ? 'tool-row-enter' : ''}>
          <div className={tc.id === presentingToolId ? 'tool-row-enter-clip' : ''}>
            {renderToolCallCard(tc, {
              ...opts,
              presentOnMount: tc.id === presentingToolId,
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export default memo(ToolCallGroup)
