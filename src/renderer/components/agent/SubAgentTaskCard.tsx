import { memo, useMemo } from 'react'
import { Check, ChevronDown, Circle, ExternalLink, GitBranch, LoaderCircle, ShieldAlert, Wrench, X } from 'lucide-react'
import type { ToolCall } from '@/renderer/agent/types'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { buildSubAgentExecutionSteps, type SubAgentStepState } from '@/renderer/agent/presentation/subAgentExecution'
import { LaneStatusChip, WorktreeLanePanel } from '@/renderer/components/git'
import { useStore } from '@/renderer/store'
import { t } from '@shared/i18n'
import type { ExecutionLaneProjection, ExecutionLaneStatus } from '@shared/types/executionLane'
import SmoothCollapse from './SmoothCollapse'
import { ToolDetailsView } from './ToolDetailsView'
import ToolActivityIndicator, { ToolElapsedTime, TOOL_ROW_ACTION_SLOT_CLASS } from './ToolActivityIndicator'
import { useDisclosureState } from '@renderer/hooks'
import { AGENT_DISCLOSURE_HANDOFF_CLOSE_MS } from '@renderer/agent/presentation/disclosureMotion'

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
const asString = (value: unknown): string => typeof value === 'string' ? value : ''
const asNumber = (value: unknown): number | undefined => typeof value === 'number' ? value : undefined

const LANE_STATUSES: ExecutionLaneStatus[] = ['active', 'ready', 'merged', 'conflict', 'discarded', 'failed']

/**
 * 从工具 meta 里取车道投影。
 *
 * `_meta` 是 `Record<string, unknown>`（会落盘、也可能来自旧版本的会话），所以这里只认
 * 带合法 status 的对象，不做类型断言 —— 旧记录里的 `{ outcome: 'retained' }` 就该被当成
 * 没有车道，而不是渲染出一张状态是 undefined 的卡。
 */
function asLane(value: unknown): ExecutionLaneProjection | undefined {
  const record = asRecord(value)
  const status = record.status
  return typeof status === 'string' && (LANE_STATUSES as string[]).includes(status)
    ? record as unknown as ExecutionLaneProjection
    : undefined
}

function StepIcon({ state }: { state: SubAgentStepState }) {
  if (state === 'complete') return <Check className="h-2.5 w-2.5 text-green-500" />
  if (state === 'error') return <X className="h-2.5 w-2.5 text-red-500" />
  if (state === 'waiting') return <ShieldAlert className="h-3 w-3 text-amber-400" />
  if (state === 'active') return <LoaderCircle className="h-3 w-3 animate-spin text-accent motion-reduce:animate-none" />
  return <Circle className="h-2.5 w-2.5 text-text-muted/30" />
}

function SubAgentTaskCard({ toolCall, messageId, isPresenting }: { toolCall: ToolCall, messageId?: string, isPresenting?: boolean }) {
  const language = useStore(state => state.language)
  const workspacePath = useStore(state => state.workspacePath)
  const meta = asRecord(toolCall.arguments._meta)
  const lane = asLane(meta.worktree)
  const threadId = asString(meta.subAgentThreadId)
  const startedAt = asNumber(meta.subAgentStartedAt)
  const finishedDuration = asNumber(meta.subAgentDurationMs)
  const childThread = useAgentStore(state => threadId ? state.threads[threadId] : undefined)
  const switchThread = useAgentStore(state => state.switchThread)

  const isRunning = toolCall.status === 'running' || toolCall.status === 'pending'
  const isSuccess = toolCall.status === 'success'
  const isError = toolCall.status === 'error' || toolCall.status === 'rejected'
  const waitingApproval = childThread?.streamState?.phase === 'tool_pending'
  const currentTool = childThread?.streamState?.currentToolCall
  const { isOpen: expanded, toggle: toggleExpanded } = useDisclosureState({
    automaticOpen: isPresenting,
    openWhile: isRunning || isError || waitingApproval,
    holdOpen: isPresenting,
    closeDelayMs: AGENT_DISCLOSURE_HANDOFF_CLOSE_MS,
  })

  const completedTools = useMemo(() => {
    let count = 0
    for (const message of childThread?.messages || []) {
      if (message.role !== 'assistant') continue
      for (const call of message.toolCalls || []) {
        if (call.status === 'success') count++
      }
    }
    return count
  }, [childThread?.messages])

  const steps = useMemo(() => buildSubAgentExecutionSteps({
    language,
    hasThread: Boolean(threadId),
    isRunning,
    isSuccess,
    isError,
    waitingApproval,
    currentToolName: currentTool?.name,
    completedToolCount: completedTools,
  }), [completedTools, currentTool?.name, isError, isRunning, isSuccess, language, threadId, waitingApproval])

  const description = asString(toolCall.arguments.description) || (t('subAgentTaskCard.subAgentTask', language))
  return <div className="group relative my-0.5 overflow-hidden">
    <button type="button" aria-expanded={expanded} onClick={toggleExpanded} className="relative z-10 flex min-h-9 w-full items-center gap-2 py-1.5 text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40">
      <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-text-muted/40 transition-transform group-hover:text-text-muted motion-reduce:transition-none ${expanded ? 'rotate-0' : '-rotate-90'}`} />
      <span className="flex shrink-0 items-center justify-center">
        {waitingApproval
          ? <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
          : <ToolActivityIndicator
              state={isRunning ? 'running' : isSuccess ? 'success' : isError ? 'error' : 'idle'}
            />}
      </span>
      <GitBranch className="h-3.5 w-3.5 shrink-0 text-text-muted/60" />
      <span className={`min-w-0 flex-1 truncate text-[12px] ${isRunning ? 'text-text-primary tool-text-shimmer' : 'text-text-secondary group-hover:text-text-primary'}`}>
        <span className="text-text-muted">SubAgent</span><span className="px-1.5 text-text-muted/35">·</span>{description}
      </span>
      <ToolElapsedTime
        state={isRunning ? 'running' : isSuccess ? 'success' : isError ? 'error' : 'idle'}
        startedAt={startedAt}
        durationMs={finishedDuration}
      />
      {waitingApproval && <span className="shrink-0 text-[10px] text-amber-400">{t('subAgentTaskCard.approvalNeeded', language)}</span>}
      {lane && <LaneStatusChip status={lane.status} language={language} className="shrink-0 text-[10px]" />}
      {completedTools > 0 && <span className="shrink-0 text-[10px] tabular-nums text-text-muted/60">{completedTools}</span>}
      {/* 占位，与文件修改行的操作图标共用同一条右边界。 */}
      <span className={TOOL_ROW_ACTION_SLOT_CLASS} aria-hidden="true" />
    </button>

    <SmoothCollapse open={expanded}><div className="relative pb-3 pl-[26px] pr-3 pt-0">
      <ToolDetailsView args={Object.fromEntries(Object.entries(toolCall.arguments).filter(([key]) => !key.startsWith('_')))} response={toolCall.error || toolCall.result} language={language} isError={isError}>
      <ol className="relative z-10 space-y-1 pt-1">
        {steps.map(step => <li key={step.id} className="flex min-h-7 items-start gap-2">
          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center"><StepIcon state={step.state} /></span>
          <span className="min-w-0 flex-1 pt-px">
            <span className="text-[11px] font-medium text-text-secondary">{step.label}</span>
            <span className="ml-2 text-[10px] text-text-muted">{step.detail}</span>
            {step.id === 'brief' && asString(toolCall.arguments.prompt) && <span className="mt-0.5 block truncate text-[10px] text-text-muted/70">{asString(toolCall.arguments.prompt)}</span>}
            {step.id === 'work' && currentTool && <span className="mt-0.5 flex items-center gap-1 text-[10px] text-text-muted"><Wrench className="h-3 w-3 text-accent/70" /><code className="font-mono">{currentTool.name}</code></span>}
          </span>
        </li>)}
      </ol>

      {(toolCall.result || toolCall.error) && !isRunning && <div className={`ml-6 mt-2 whitespace-pre-wrap break-words py-2 text-[11px] leading-5 ${isError ? 'text-status-error' : 'text-text-secondary'}`}>{toolCall.error || toolCall.result}</div>}
      </ToolDetailsView>
      {/* 子代理跑在独立车道里时，改动可能没能自动合并 —— 提交只留在 adnify/lane-* 分支上。
          恢复入口必须挂在这张卡上：子代理没有任务面板，聊天流是用户唯一能看到它的地方。 */}
      {lane && <div className="ml-6">
        <WorktreeLanePanel
          flat
          lane={lane}
          workspacePath={workspacePath}
          language={language}
          onResolved={(status, diagnosis) => {
            if (!messageId) return
            useAgentStore.getState().updateToolCall(messageId, toolCall.id, {
              arguments: {
                ...toolCall.arguments,
                _meta: { ...meta, worktree: { ...lane, status, notice: diagnosis?.notice, error: diagnosis?.error, conflicts: diagnosis?.conflicts } },
              },
            })
          }}
        />
      </div>}
      {threadId && <button type="button" onClick={() => switchThread(threadId)} className="ml-6 mt-2 inline-flex items-center gap-1.5 text-[10px] font-medium text-accent hover:underline"><ExternalLink className="h-3 w-3" />{t('subAgentTaskCard.openSubTask', language)}</button>}
    </div></SmoothCollapse>
  </div>
}

export default memo(SubAgentTaskCard)
