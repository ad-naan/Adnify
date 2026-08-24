/**
 * 工具执行模块
 * 
 * 职责：
 * - 工具审批流程
 * - 智能并行执行
 * - 文件快照保存（用于撤销）
 * - 工具结果截断（防止单轮对话过长）
 * - 发布事件到 EventBus
 */

import pLimit from 'p-limit'
import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { toolManager } from '../tools/providers'
import { getToolApprovalType, getToolMetadata, isFileEditTool, needsFileSnapshot } from '@/shared/config/tools'
import { pathStartsWith, joinPath, isPathInWorkspace, isSensitivePath, toFullPath } from '@shared/utils/pathUtils'
import { useStore } from '@store'
import { EventBus } from './EventBus'
import { getAgentConfig } from '../utils/AgentConfig'
import {
  boundTextOutput,
  clampOutputBudget,
  replaceOversizedJsonOutput,
} from '@shared/utils/toolOutput'
import type { ToolCall } from '@/shared/types'
import type { ToolExecutionContext, AgentToolExecutionResult } from './types'
import { approvalService } from './approvalService'
import { useAgentStore } from '../store/AgentStore'
import { buildExecutionBatches } from './toolExecutionPlan'
import { streamingEditService } from '../services/streamingEditService'
import { resolveStreamingEditFilePath } from '../services/streamingEditPreview'
import { shellServerRoutingService } from '../services/shellServerRoutingService'
import { sanitizeToolRichContent, sanitizeToolTextOutput } from '../tools/toolOutputSanitizer'
import { isTerminalCommandEligibleForAutoApproval } from '../utils/commandApproval'
import {
  assessShellCommand,
  commandApprovalScope,
  fileApprovalScope,
  isAlwaysApprovalTool,
  type AgentApprovalProof,
} from '@shared/security/executionPolicy'

// ===== 文件快照 =====

/**
 * 在工具执行前保存文件快照到检查点
 * 用于支持撤销功能
 */
async function saveFileSnapshots(
  toolCalls: ToolCall[],
  context: ToolExecutionContext
): Promise<void> {
  // Checkpoint 操作是全局的，不需要 threadStore
  const store = useAgentStore.getState()
  const { workspacePath } = context

  // 找出所有需要保存快照的工具（包括删除操作）
  const snapshotTools = toolCalls.filter(tc => needsFileSnapshot(tc.name))
  if (snapshotTools.length === 0) return

  // 并行读取所有文件的当前内容
  const snapshotPromises = snapshotTools.map(async (tc) => {
    const path = tc.arguments?.path as string
    if (!path) return null

    const fullPath = workspacePath && !pathStartsWith(path, workspacePath)
      ? joinPath(workspacePath, path)
      : path

    try {
      const content = await api.file.read(fullPath)
      return { filePath: fullPath, content }
    } catch {
      // 文件不存在，content 为 null（新建文件）
      return { filePath: fullPath, content: null }
    }
  })

  const snapshots = await Promise.all(snapshotPromises)

  // 保存到检查点
  for (const snapshot of snapshots) {
    if (snapshot) {
      if (context.checkpointId) {
        store.addSnapshotToCheckpoint(context.checkpointId, snapshot.filePath, snapshot.content)
      }
    }
  }
}

interface ToolExecutionIdentity {
  threadId?: string
  assistantId?: string
  requestId?: string
  toolCallId?: string
}

function buildToolExecutionIdentity(
  toolCall: ToolCall,
  context: ToolExecutionContext
): ToolExecutionIdentity {
  return {
    threadId: context.threadId ?? undefined,
    assistantId: context.assistantId ?? context.currentAssistantId ?? undefined,
    requestId: context.requestId,
    toolCallId: context.toolCallId ?? toolCall.id,
  }
}

function emitToolEvent(
  event:
    | ({ type: 'tool:pending'; id: string; name: string; args: Record<string, unknown> } & ToolExecutionIdentity)
    | ({ type: 'tool:running'; id: string } & ToolExecutionIdentity)
    | ({ type: 'tool:completed'; id: string; result: string; meta?: Record<string, unknown> } & ToolExecutionIdentity)
    | ({ type: 'tool:error'; id: string; error: string } & ToolExecutionIdentity)
    | ({ type: 'tool:rejected'; id: string } & ToolExecutionIdentity)
): void {
  EventBus.emit(event)
}

function buildDependencyErrorResult(
  toolCall: ToolCall,
  reason: string
): AgentToolExecutionResult {
  return {
    toolCall,
    result: {
      content: reason,
      // 依赖没满足属于「跳过」，不是这个工具自己失败了
      status: 'skipped',
      meta: {
        outcome: 'dependency_failed',
        skippedDueToDependency: true,
      },
    },
  }
}

/**
 * 依赖是否算「没成功」。
 *
 * 以前是 `content.startsWith('Skipped: dependency') || content.startsWith('Error: dependency')`
 * —— 只认这两种文案，别的失败形态（工具自身报错、被用户拒绝）得靠调用点额外
 * 查 failed/rejected 两个 Set 兜底，而那两个 Set 的写入时机和这里的读取时机是
 * 并发的。现在直接看声明出来的 status，不依赖文案也不依赖写入顺序。
 */
function isUnsuccessful(result: AgentToolExecutionResult): boolean {
  return result.result.status !== 'success'
}

const REMOTE_ROUTE_META_TOOL_NAMES = new Set([
  'run_command',
  'list_remote_directory',
  'read_remote_file',
  'write_remote_file',
  'rename_remote_path',
  'delete_remote_path',
  'upload_to_remote',
  'download_from_remote',
])

const REMOTE_ONLY_TOOL_NAMES = new Set([
  'list_remote_directory',
  'read_remote_file',
  'write_remote_file',
  'rename_remote_path',
  'delete_remote_path',
  'upload_to_remote',
  'download_from_remote',
])

const reusableApprovals = new Map<string, { approvedAt: number; forTask: boolean }>()
const taskApprovals = new Set<string>()
const rejectedApprovalScopes = new Set<string>()
const REUSABLE_APPROVAL_TTL_MS = 2 * 60_000

function toolApprovalScope(toolCall: ToolCall, context: ToolExecutionContext): string {
  if (toolCall.name === 'run_command' && !toolCall.arguments.server_name) {
    const command = typeof toolCall.arguments.command === 'string' ? toolCall.arguments.command : ''
    const cwdArg = typeof toolCall.arguments.cwd === 'string' ? toolCall.arguments.cwd : context.workspacePath || ''
    return commandApprovalScope(command, toFullPath(cwdArg, context.workspacePath))
  }

  if (!REMOTE_ONLY_TOOL_NAMES.has(toolCall.name) && typeof toolCall.arguments?.path === 'string') {
    const metadata = getToolMetadata(toolCall.name)
    const access = toolCall.name === 'delete_file_or_folder' || toolCall.name === 'create_directory'
      ? 'manage'
      : (metadata?.resourceScope || []).some(item => item.includes('write')) ? 'write' : 'read'
    return fileApprovalScope(toFullPath(toolCall.arguments.path, context.workspacePath), access)
  }

  return `tool:${toolCall.name}:${JSON.stringify(toolCall.arguments)}`
}

function rejectedApprovalKey(toolCall: ToolCall, context: ToolExecutionContext): string | null {
  if (!context.requestId) return null
  return `${context.requestId}:${toolApprovalScope(toolCall, context)}`
}

function taskApprovalKey(toolCall: ToolCall, context: ToolExecutionContext): string | null {
  const key = rejectedApprovalKey(toolCall, context)
  if (!key || toolCall.name === 'delete_file_or_folder' || REMOTE_ONLY_TOOL_NAMES.has(toolCall.name)) return null
  if (toolCall.name === 'run_command') {
    if (toolCall.arguments.server_name) return null
    const command = typeof toolCall.arguments.command === 'string' ? toolCall.arguments.command : ''
    const decision = assessShellCommand(command, [])
    if (decision.risk === 'dangerous' || decision.kind === 'deny') return null
  }
  return typeof toolCall.arguments?.path === 'string' || toolCall.name === 'run_command' ? key : null
}

function reusableApprovalKey(toolCall: ToolCall, context: ToolExecutionContext): string | null {
  if (!context.requestId) return null

  if (toolCall.name === 'run_command' && !toolCall.arguments.server_name) {
    const command = typeof toolCall.arguments.command === 'string' ? toolCall.arguments.command.trim() : ''
    if (!command || assessShellCommand(command, []).risk !== 'elevated') return null
    const cwd = typeof toolCall.arguments.cwd === 'string' ? toolCall.arguments.cwd : context.workspacePath || ''
    return `${context.requestId}:command:${cwd}:${command}`
  }

  if (toolCall.name === 'delete_file_or_folder' || REMOTE_ONLY_TOOL_NAMES.has(toolCall.name)) return null
  const pathArg = toolCall.arguments?.path
  if (typeof pathArg !== 'string' || !context.workspacePath) return null
  const fullPath = toFullPath(pathArg, context.workspacePath)
  const strictWorkspaceMode = useStore.getState().securitySettings?.strictWorkspaceMode !== false
  if (isSensitivePath(fullPath) || (strictWorkspaceMode && !isPathInWorkspace(fullPath, context.workspacePath))) {
    return `${context.requestId}:path:${toolCall.name}:${fullPath}`
  }
  return null
}

function hasReusableApproval(toolCall: ToolCall, context: ToolExecutionContext): boolean {
  const taskKey = taskApprovalKey(toolCall, context)
  if (taskKey && taskApprovals.has(taskKey)) return true
  const key = reusableApprovalKey(toolCall, context)
  if (!key) return false
  const approval = reusableApprovals.get(key)
  if (!approval || (!approval.forTask && Date.now() - approval.approvedAt > REUSABLE_APPROVAL_TTL_MS)) {
    reusableApprovals.delete(key)
    return false
  }
  return true
}

function buildApprovedExecutionContext(toolCall: ToolCall, context: ToolExecutionContext): ToolExecutionContext {
  const approval: AgentApprovalProof = {
    requestId: context.requestId || toolCall.id,
    toolCallId: toolCall.id,
    approvedAt: Date.now(),
    scope: toolApprovalScope(toolCall, context),
  }
  return { ...context, securityApproval: approval }
}

function rememberReusableApproval(key: string, forTask = false): void {
  reusableApprovals.delete(key)
  reusableApprovals.set(key, { approvedAt: Date.now(), forTask })
  while (reusableApprovals.size > 512) {
    const oldest = reusableApprovals.keys().next().value
    if (typeof oldest !== 'string') break
    reusableApprovals.delete(oldest)
  }
}

function rememberTaskApproval(key: string): void {
  taskApprovals.delete(key)
  taskApprovals.add(key)
  while (taskApprovals.size > 512) {
    const oldest = taskApprovals.values().next().value
    if (typeof oldest !== 'string') break
    taskApprovals.delete(oldest)
  }
}

function rememberRejectedApproval(key: string): void {
  rejectedApprovalScopes.delete(key)
  rejectedApprovalScopes.add(key)
  while (rejectedApprovalScopes.size > 512) {
    const oldest = rejectedApprovalScopes.values().next().value
    if (typeof oldest !== 'string') break
    rejectedApprovalScopes.delete(oldest)
  }
}

function buildShellRouteMeta(target: {
  executionTarget: 'local' | 'remote'
  resolvedBy: 'arg' | 'explicit_context' | 'last_active_server' | 'auto_routing' | 'local_default'
  server?: { serverLinkId: string; serverName: string } | null
}): Record<string, unknown> {
  return {
    executionTarget: target.executionTarget,
    serverLinkId: target.server?.serverLinkId,
    serverName: target.server?.serverName,
    resolvedBy: target.resolvedBy,
  }
}

async function enrichToolArgumentsWithRoutingMeta(
  toolCall: ToolCall,
  context: ToolExecutionContext
): Promise<Record<string, unknown>> {
  if (!REMOTE_ROUTE_META_TOOL_NAMES.has(toolCall.name)) {
    return toolCall.arguments
  }

  const explicitServerName = typeof toolCall.arguments.server_name === 'string'
    ? toolCall.arguments.server_name.trim()
    : ''

  if (explicitServerName) {
    const explicitResolution = await shellServerRoutingService.resolveServerName(explicitServerName)
    if (explicitResolution.kind === 'not_found' || explicitResolution.kind === 'ambiguous') {
      return {
        ...toolCall.arguments,
        _meta: {
          ...(toolCall.arguments._meta as Record<string, unknown> | undefined),
          executionTarget: 'remote',
          resolvedBy: 'arg',
          routeError: explicitResolution.kind === 'not_found'
            ? `Remote server not found: ${explicitServerName}`
            : `Remote server name is ambiguous: ${explicitServerName}`,
        },
      }
    }
  }

  const target = await shellServerRoutingService.resolveExecutionTarget(toolCall.name, toolCall.arguments, {
    threadId: context.threadId,
    assistantId: context.assistantId,
    currentAssistantId: context.currentAssistantId,
  })

  const baseMeta = buildShellRouteMeta(target)
  const needsRemoteButUnresolved = REMOTE_ONLY_TOOL_NAMES.has(toolCall.name) && target.executionTarget !== 'remote'

  return {
    ...toolCall.arguments,
    _meta: {
      ...(toolCall.arguments._meta as Record<string, unknown> | undefined),
      ...(needsRemoteButUnresolved
        ? {
            executionTarget: 'remote',
            resolvedBy: target.resolvedBy,
            routeError: `No remote server resolved for ${toolCall.name}`,
          }
        : baseMeta),
    },
  }
}


/**
 * 检查工具是否需要审批
 * 基于 TOOL_CONFIGS 中的 approvalType 配置和用户的 autoApprove 设置
 */
function needsApproval(toolCall: ToolCall, context: ToolExecutionContext): boolean {
  const approvalType = getToolApprovalType(toolCall.name)

  if (hasReusableApproval(toolCall, context)) return false

  // Local destructive actions and exceptional paths use the existing tool Dock.
  // The resulting proof suppresses a second native main-process dialog.
  if (toolCall.name === 'delete_file_or_folder') return true

  const pathArg = toolCall.arguments?.path
  if (typeof pathArg === 'string' && context.workspacePath && !REMOTE_ONLY_TOOL_NAMES.has(toolCall.name)) {
    const fullPath = toFullPath(pathArg, context.workspacePath)
    const strictWorkspaceMode = useStore.getState().securitySettings?.strictWorkspaceMode !== false
    if (isSensitivePath(fullPath) || (strictWorkspaceMode && !isPathInWorkspace(fullPath, context.workspacePath))) {
      return true
    }
  }

  // This invariant is stronger than per-user auto-approval preferences.
  if (isAlwaysApprovalTool(toolCall.name)) return true

  // 如果工具本身不需要审批，直接返回 false
  if (approvalType === 'none') return false

  // 检查用户的 autoApprove 设置
  const mainStore = useStore.getState()
  const autoApprove = mainStore.autoApprove

  // 根据工具类型检查对应的 autoApprove 设置
  if (toolCall.name === 'run_command') {
    if (toolCall.arguments.server_name) return true
    const cwd = toolCall.arguments.cwd
    if (typeof cwd === 'string' && context.workspacePath && !isPathInWorkspace(cwd, context.workspacePath)) {
      return true
    }
    const trustedCommands = mainStore.securitySettings?.allowedShellCommands || []
    const shellDecision = typeof toolCall.arguments.command === 'string'
      ? assessShellCommand(toolCall.arguments.command, trustedCommands)
      : null
    // Structurally invalid input is rejected by the main process and should not
    // waste the user's time with an approval that cannot make it executable.
    if (shellDecision?.kind === 'deny') return false
    if (
      shellDecision?.kind === 'allow'
      && isTerminalCommandEligibleForAutoApproval(
        toolCall.arguments.command,
        autoApprove?.terminalCommandRules,
        trustedCommands,
      )
    ) {
      return false
    }
  }

  // 默认需要审批
  return true
}

/**
 * 获取动态并发限制
 */
function getDynamicConcurrency(): number {
  const agentConfig = getAgentConfig()
  const { enabled, minConcurrency, maxConcurrency, cpuMultiplier } = agentConfig.dynamicConcurrency

  if (!enabled) {
    return 8  // 默认固定值
  }

  // 获取 CPU 核心数（浏览器环境）
  const cpuCores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
    ? navigator.hardwareConcurrency
    : 4

  // 计算并发数：CPU 核心数 * 倍数
  const calculated = Math.floor(cpuCores * cpuMultiplier)

  // 限制在最小和最大值之间
  const concurrency = Math.max(minConcurrency, Math.min(maxConcurrency, calculated))

  logger.agent.info(`[Tools] Dynamic concurrency: ${concurrency} (CPU cores: ${cpuCores})`)

  return concurrency
}

/**
 * 分析工具依赖关系（支持显式声明）
 */
function analyzeToolDependencies(toolCalls: ToolCall[]): Map<string, Set<string>> {
  const deps = new Map<string, Set<string>>()
  const fileWriters = new Map<string, string>() // path -> toolCallId
  const agentConfig = getAgentConfig()
  const declaredDeps = agentConfig.toolDependencies || {}

  for (const tc of toolCalls) {
    deps.set(tc.id, new Set())

    // 1. 检查显式声明的依赖
    const declaredDep = declaredDeps[tc.name]
    if (declaredDep) {
      // 查找依赖的工具调用
      for (const depToolName of declaredDep.dependsOn) {
        const depToolCall = toolCalls.find(t => t.name === depToolName && t.id !== tc.id)
        if (depToolCall) {
          deps.get(tc.id)!.add(depToolCall.id)
          logger.agent.info(`[Tools] Explicit dependency: ${tc.name} depends on ${depToolName}`)
        }
      }
    }

    // 2. 隐式依赖：文件编辑依赖
    if (isFileEditTool(tc.name)) {
      const path = tc.arguments?.path as string
      if (path) {
        // 如果之前有工具写过这个文件，建立依赖
        const prevWriter = fileWriters.get(path)
        if (prevWriter) {
          deps.get(tc.id)!.add(prevWriter)
        }
        fileWriters.set(path, tc.id)
      }
    }
  }

  return deps
}

/**
 * Execute a tool through the manager, retrying only when it is genuinely safe.
 *
 * `ToolManager` computes `envelope.retryable` per attempt, but nothing consumed it:
 * `executeSingle` dropped both `envelope` and `outcome`, and every tool declared
 * `retryPolicy: { maxAttempts: 1 }`, which makes `inferRetryable` return false
 * unconditionally. So the whole retry subsystem was inert and a transient network
 * blip surfaced to the model as a hard tool error.
 *
 * Retry is deliberately narrow:
 *  - the tool must opt in via `retryPolicy.maxAttempts > 1`
 *  - the tool must be free of side effects. Never retry a write or a command:
 *    a "failed" write may have partially applied, and repeating it can double-apply.
 *    Note this is judged by category/resourceScope, NOT by the `parallel` flag —
 *    `web_search` is `parallel: false` purely to discourage scattered searches,
 *    yet it is perfectly safe to retry.
 *  - the manager must classify the failure as retryable (timeout / execution /
 *    dependency, not validation or user rejection)
 */
const RETRY_SAFE_CATEGORIES = new Set(['read', 'search', 'lsp', 'network'])

function isRetrySafe(metadata: ReturnType<typeof getToolMetadata>): boolean {
  if (!metadata) return false
  if (!RETRY_SAFE_CATEGORIES.has(metadata.category)) return false
  // Belt and braces: a read-category tool that declares a write scope is not safe.
  return !(metadata.resourceScope || []).some(scope => scope.includes('write'))
}

async function executeWithRetry(
  toolName: string,
  toolArguments: Record<string, unknown>,
  managerContext: Parameters<typeof toolManager.execute>[2]
): Promise<Awaited<ReturnType<typeof toolManager.execute>>> {
  const metadata = getToolMetadata(toolName)
  const maxAttempts = Math.max(1, metadata?.retryPolicy?.maxAttempts ?? 1)
  const attemptLimit = isRetrySafe(metadata) ? maxAttempts : 1

  let result = await toolManager.execute(toolName, toolArguments, managerContext)

  for (let attempt = 2; attempt <= attemptLimit; attempt++) {
    if (result.success) break
    const retryable = result.envelope?.retryable ?? result.outcome?.retryable ?? false
    if (!retryable) break

    logger.agent.info(
      `[Tools] Retrying ${toolName} (attempt ${attempt}/${attemptLimit}) after retryable failure: ${result.error || 'unknown'}`
    )
    result = await toolManager.execute(toolName, toolArguments, managerContext)
  }

  return result
}

/**
 * 工具结果进入模型上下文前的唯一收敛点。
 *
 * 按工具声明的 outputFormat 分派：
 *  - json: 执行器已经用降级阶梯把结果压进预算，这里只做兜底校验。超预算说明有
 *    未预期的巨大载荷（典型是 MCP 工具），此时整体替换成合法信封 —— 结构化数据
 *    被「留头 + 留尾」切开之后不再可解析，模型拿到的是语法残骸，UI 的 JSON.parse
 *    也会静默失败退成空列表。丢掉整个结果反而是更诚实的失败。
 *  - text: 保留工具声明的信号端，中间插入省略说明。
 *
 * 失败结果一律按 text 处理：错误信息本身是给人读的，而不是原工具的结构化输出。
 */
function boundToolOutput(toolName: string, rawContent: string, success: boolean): string {
  const budget = clampOutputBudget(getAgentConfig().maxToolResultChars)
  const metadata = getToolMetadata(toolName)

  if (success && metadata?.outputFormat === 'json') {
    if (rawContent.length <= budget) return rawContent
    logger.agent.warn(
      `[Tools] ${toolName} returned ${rawContent.length} chars of JSON, over the ${budget} budget; replaced rather than cut mid-structure`
    )
    return replaceOversizedJsonOutput(rawContent.length, budget)
  }

  return boundTextOutput(rawContent, budget, metadata?.outputSignal ?? 'head')
}

/**
 * 执行单个工具
 */
async function executeSingle(
  toolCall: ToolCall,
  context: ToolExecutionContext,
  store: import('../store/AgentStore').ThreadBoundStore
): Promise<AgentToolExecutionResult> {
  const mainStore = useStore.getState()
  const { currentAssistantId, workspacePath } = context
  const identity = buildToolExecutionIdentity(toolCall, context)
  const startTime = Date.now()
  const toolArguments = await enrichToolArgumentsWithRoutingMeta(toolCall, context)

  if (currentAssistantId) {
    store.finalizeTextBeforeToolCall(currentAssistantId)
    store.addToolCallPart(currentAssistantId, {
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolArguments,
    })
    store.updateToolCall(currentAssistantId, toolCall.id, {
      arguments: toolArguments,
      status: 'running',
      streamingState: undefined,
    })
    store.clearToolStreamingPreview(toolCall.id)
    store.setStreamState({
      phase: 'tool_running',
      currentToolCall: toolCall,
      statusText: undefined,
      requestId: context.requestId,
      assistantId: currentAssistantId,
    })
  }
  emitToolEvent({ type: 'tool:running', id: toolCall.id, ...identity })

  // 记录请求日志
  mainStore.addToolCallLog({
    threadId: context.threadId ?? undefined,
    type: 'request',
    toolName: toolCall.name,
    data: toolArguments,
  })

  try {
    const result = await executeWithRetry(
      toolCall.name,
      toolArguments,
      {
        workspacePath: workspacePath ?? null,
        currentAssistantId: currentAssistantId ?? null,
        assistantId: currentAssistantId ?? null,
        threadId: context.threadId,
        requestId: context.requestId,
        toolCallId: toolCall.id,
        chatMode: context.chatMode,
        securityApproval: context.securityApproval,
      }
    )

    const duration = Date.now() - startTime

    const rawContent = sanitizeToolTextOutput(result.success
      ? (result.result !== undefined && result.result !== null ? result.result : 'Success')
      : `Error: ${result.error || 'Unknown error'}`)

    const content = boundToolOutput(toolCall.name, rawContent, result.success)

    if (content.length < rawContent.length) {
      logger.agent.info(`[Tools] Bounded ${toolCall.name} result: ${rawContent.length} -> ${content.length} chars`)
    }

    // 记录响应日志
    mainStore.addToolCallLog({
      threadId: context.threadId ?? undefined,
      type: 'response',
      toolName: toolCall.name,
      data: content,
      duration,
      success: result.success,
      error: result.success ? undefined : result.error,
    })

    const meta = result.meta || {}
    const richContent = sanitizeToolRichContent(result.richContent)
    const previewPath = resolveStreamingEditFilePath(toolCall.arguments?.path, workspacePath)

    if (toolCall.name === 'edit_file' && previewPath) {
      if (result.success) {
        const finalContent = typeof meta.newContent === 'string' ? meta.newContent : undefined
        streamingEditService.completeEditByFilePath(previewPath, finalContent)
      } else {
        streamingEditService.cancelEditByFilePath(previewPath)
      }
    }

    // 更新状态，并将 meta 数据合并到 arguments._meta
    if (currentAssistantId) {
      const updatedArguments = Object.keys(meta).length > 0
        ? { ...toolArguments, _meta: { ...(toolArguments._meta as Record<string, unknown> | undefined), ...meta } }
        : toolArguments

      const newStatus = result.success ? 'success' : 'error'

      store.updateToolCall(currentAssistantId, toolCall.id, {
        status: newStatus,
        result: content,
        arguments: updatedArguments,
        richContent,
        streamingState: undefined,  // 清除流式状态
      })

      store.addToolResult(toolCall.id, toolCall.name, content, result.success ? 'success' : 'tool_error')
    }
    if (result.success) {
      emitToolEvent({
        type: 'tool:completed',
        id: toolCall.id,
        result: content,
        meta,
        ...identity,
      })
    } else {
      emitToolEvent({
        type: 'tool:error',
        id: toolCall.id,
        error: content,
        ...identity,
      })
    }

    return { toolCall, result: { content, status: result.success ? 'success' : 'error', meta, richContent } }
  } catch (error) {
    const duration = Date.now() - startTime
    const errorMsg = sanitizeToolTextOutput(error instanceof Error ? error.message : String(error))
    logger.agent.error(`[Tools] Error in ${toolCall.name}:`, errorMsg)

    // 记录错误日志
    mainStore.addToolCallLog({
      threadId: context.threadId ?? undefined,
      type: 'response',
      toolName: toolCall.name,
      data: errorMsg,
      duration,
      success: false,
      error: errorMsg,
    })

    const previewPath = resolveStreamingEditFilePath(toolCall.arguments?.path, workspacePath)
    if (toolCall.name === 'edit_file' && previewPath) {
      streamingEditService.cancelEditByFilePath(previewPath)
    }

    if (currentAssistantId) {
      store.updateToolCall(currentAssistantId, toolCall.id, {
        status: 'error',
        result: errorMsg,
        streamingState: undefined,  // 清除流式状态
      })
      store.addToolResult(toolCall.id, toolCall.name, `Error: ${errorMsg}`, 'tool_error')
    }
    emitToolEvent({ type: 'tool:error', id: toolCall.id, error: errorMsg, ...identity })

    return { toolCall, result: { content: `Error: ${errorMsg}`, status: 'error' } }
  }
}

/**
 * 执行工具列表（智能并行 + 逐个审批）
 * 
 * 审批策略：
 * - 不需要审批的工具：并行执行（带并发限制）
 * - 需要审批的工具：逐个审批，用户可以选择批准或拒绝每个工具
 * - 如果用户拒绝某个工具，该工具被跳过，继续执行其他工具
 */
export async function executeTools(
  toolCalls: ToolCall[],
  context: ToolExecutionContext,
  store: import('../store/AgentStore').ThreadBoundStore,
  abortSignal?: AbortSignal
): Promise<{ results: AgentToolExecutionResult[]; hadRejectedTool: boolean }> {
  const results: AgentToolExecutionResult[] = []
  let hadRejectedTool = false

  if (toolCalls.length === 0) {
    return { results, hadRejectedTool }
  }

  // 分析依赖
  const deps = analyzeToolDependencies(toolCalls)
  const completed = new Set<string>()
  const rejected = new Set<string>()
  const failed = new Set<string>()
  const pending = new Set(toolCalls.map(tc => tc.id))

  // 分离需要审批和不需要审批的工具
  const approvalRequired = toolCalls.filter(tc => needsApproval(tc, context))
  const noApprovalRequired = toolCalls.filter(tc => !needsApproval(tc, context))

  // 在执行前保存文件快照
  await saveFileSnapshots(toolCalls, context)

  // 1. 先执行不需要审批的工具。
  //    注意：即使无需审批，也必须尊重工具的 parallel 配置。
  //    例如 todo_write / create_task_plan 这类工具绝不能与 read/write 混在同一批并行。
  if (noApprovalRequired.length > 0) {
    store.setStreamState({
      phase: 'tool_running',
      statusText: undefined,
      requestId: context.requestId,
      assistantId: context.assistantId ?? context.currentAssistantId ?? undefined,
    })

    const concurrency = getDynamicConcurrency()
    const limit = pLimit(concurrency)

    // 记录当前并行批次；遇到非并行工具时会先 flush。

    // 用于记录无审批工具的执行 Promise，以支持依赖等待
    const inFlight: Promise<AgentToolExecutionResult>[] = []
    const noApprovalPromiseMap = new Map<string, Promise<AgentToolExecutionResult>>()

    for (const batch of buildExecutionBatches(noApprovalRequired)) {
      for (const tc of batch.toolCalls) {
      if (!batch.parallel && inFlight.length > 0) {
        await Promise.allSettled(inFlight)
        inFlight.length = 0
      }

      const promise = (async () => {
        // 等待被依赖的无审批工具执行完毕
        const tcDeps = deps.get(tc.id) || new Set()
        const depPromises = Array.from(tcDeps)
          .map(depId => noApprovalPromiseMap.get(depId))
          .filter(Boolean) as Promise<AgentToolExecutionResult>[]

        if (depPromises.length > 0) {
          const depResults = await Promise.all(depPromises)
          const blocked = depResults.some(depResult => isUnsuccessful(depResult) || rejected.has(depResult.toolCall.id) || failed.has(depResult.toolCall.id))
          if (blocked) {
            const skipped = buildDependencyErrorResult(tc, 'Skipped: dependency failed')
            if (context.currentAssistantId) {
              store.updateToolCall(context.currentAssistantId, tc.id, {
                status: 'error',
                result: skipped.result.content,
                streamingState: undefined,
              })
            }
            failed.add(tc.id)
            pending.delete(tc.id)
            results.push(skipped)
            emitToolEvent({
              type: 'tool:error',
              id: tc.id,
              error: skipped.result.content,
              ...buildToolExecutionIdentity(tc, context),
            })
            return skipped
          }
        }

        const run = async () => {
          try {
            const executionContext = hasReusableApproval(tc, context)
              ? buildApprovedExecutionContext(tc, context)
              : context
            const result = await executeSingle(tc, executionContext, store)
            results.push(result)
            pending.delete(result.toolCall.id)
            if (result.result.status === 'success') {
              completed.add(result.toolCall.id)
            } else {
              failed.add(result.toolCall.id)
            }
            return result
          } catch (error) {
            logger.agent.error(`[Tools] Unexpected error in ${tc.name}:`, error)
            const errorMsg = error instanceof Error ? error.message : String(error)

            if (context.currentAssistantId) {
              store.updateToolCall(context.currentAssistantId, tc.id, {
                status: 'error',
                result: errorMsg,
                streamingState: undefined,
              })
            }

            failed.add(tc.id)
            pending.delete(tc.id)
            const errorResult: AgentToolExecutionResult = {
              toolCall: tc,
              result: { content: `Error: ${errorMsg}`, status: 'error' },
            }
            results.push(errorResult)
            emitToolEvent({
              type: 'tool:error',
              id: tc.id,
              error: errorMsg,
              ...buildToolExecutionIdentity(tc, context),
            })
            return errorResult
          }
        }

        return batch.parallel ? limit(run) : run()
      })()
      noApprovalPromiseMap.set(tc.id, promise)

      if (batch.parallel) {
        inFlight.push(promise)
      } else {
        await promise
      }
      }

      if (batch.parallel && inFlight.length > 0) {
        await Promise.allSettled(inFlight)
        inFlight.length = 0
      }
    }

    if (inFlight.length > 0) {
      await Promise.allSettled(inFlight)
    }
  }

  // 2. 逐个处理需要审批的工具
  for (const tc of approvalRequired) {
    if (abortSignal?.aborted) break

    if (hadRejectedTool) {
      const content = 'Skipped because another approval in this batch was rejected by the user.'
      rejected.add(tc.id)
      pending.delete(tc.id)
      if (context.currentAssistantId) {
        store.updateToolCall(context.currentAssistantId, tc.id, {
          status: 'rejected',
          result: content,
          streamingState: undefined,
        })
      }
      emitToolEvent({ type: 'tool:rejected', id: tc.id, ...buildToolExecutionIdentity(tc, context) })
      results.push({ toolCall: tc, result: { content, status: 'rejected' } })
      continue
    }

    // 检查依赖是否满足（依赖的工具必须已完成且未失败/未被拒绝）
    const tcDeps = deps.get(tc.id) || new Set()
    const depsOk = Array.from(tcDeps).every(dep => completed.has(dep) && !rejected.has(dep) && !failed.has(dep))

    if (!depsOk) {
      const skipped = buildDependencyErrorResult(tc, 'Skipped: dependency not met')
      if (context.currentAssistantId) {
        store.updateToolCall(context.currentAssistantId, tc.id, {
          status: 'error',
          result: skipped.result.content,
          streamingState: undefined,
        })
      }
      failed.add(tc.id)
      results.push(skipped)
      pending.delete(tc.id)
      emitToolEvent({
        type: 'tool:error',
        id: tc.id,
        error: skipped.result.content,
        ...buildToolExecutionIdentity(tc, context),
      })
      continue
    }

    // The approval-required partition is built before the first Dock decision.
    // Re-check here so exact duplicates later in the same batch can reuse the
    // newly approved request-scoped decision instead of opening another Dock.
    if (hasReusableApproval(tc, context)) {
      store.setStreamState({
        phase: 'tool_running',
        currentToolCall: undefined,
        statusText: undefined,
        requestId: context.requestId,
        assistantId: context.assistantId ?? context.currentAssistantId ?? undefined,
      })
      const reusedResult = await executeSingle(tc, buildApprovedExecutionContext(tc, context), store)
      results.push(reusedResult)
      pending.delete(tc.id)
      if (reusedResult.result.status === 'success') completed.add(tc.id)
      else failed.add(tc.id)
      continue
    }

    const rejectionKey = rejectedApprovalKey(tc, context)
    if (rejectionKey && rejectedApprovalScopes.has(rejectionKey)) {
      const content = 'Rejected earlier in this turn. Do not retry this operation without a new user instruction.'
      hadRejectedTool = true
      rejected.add(tc.id)
      pending.delete(tc.id)
      if (context.currentAssistantId) {
        store.updateToolCall(context.currentAssistantId, tc.id, {
          status: 'rejected',
          result: content,
          streamingState: undefined,
        })
      }
      emitToolEvent({ type: 'tool:rejected', id: tc.id, ...buildToolExecutionIdentity(tc, context) })
      results.push({ toolCall: tc, result: { content, status: 'rejected' } })
      continue
    }

    const pendingArguments = await enrichToolArgumentsWithRoutingMeta(tc, context)
    if (context.currentAssistantId) {
      store.finalizeTextBeforeToolCall(context.currentAssistantId)
      store.addToolCallPart(context.currentAssistantId, {
        id: tc.id,
        name: tc.name,
        arguments: pendingArguments,
      })
      store.updateToolCall(context.currentAssistantId, tc.id, {
        arguments: pendingArguments,
        status: 'awaiting',
      })
    }
    // The approval card is a validated tool call, not a streaming proposal.
    // Persist it before entering tool_pending so the user can inspect the exact
    // command or file operation before deciding whether to allow it.
    store.setStreamState({
      phase: 'tool_pending',
      currentToolCall: { ...tc, arguments: pendingArguments, status: 'awaiting' },
      statusText: undefined,
      requestId: context.requestId,
      assistantId: context.assistantId ?? context.currentAssistantId ?? undefined,
    })
    emitToolEvent({
      type: 'tool:pending',
      id: tc.id,
      name: tc.name,
      args: pendingArguments,
      ...buildToolExecutionIdentity(tc, context),
    })

    // 等待用户审批
    const decision = await approvalService.waitForApproval(context.requestId)

    if (decision === 'reject' || abortSignal?.aborted) {
      // 用户拒绝了这个工具
      hadRejectedTool = true
      if (rejectionKey) rememberRejectedApproval(rejectionKey)
      rejected.add(tc.id)
      if (context.currentAssistantId) {
        store.updateToolCall(context.currentAssistantId, tc.id, {
          status: 'rejected',
          streamingState: undefined,
        })
      }
      emitToolEvent({ type: 'tool:rejected', id: tc.id, ...buildToolExecutionIdentity(tc, context) })
      results.push({
        toolCall: tc,
        result: {
          content: 'Rejected by user. Do not retry the same operation in this turn; explain the rejection or choose a genuinely safer alternative.',
          status: 'rejected',
        },
      })
      pending.delete(tc.id)

      // 剩余待审批操作会被跳过，结果统一返回给模型重新规划。
      continue
    }

    // 用户批准，执行工具
    store.setStreamState({
      phase: 'tool_running',
      currentToolCall: undefined,
      statusText: undefined,
      requestId: context.requestId,
      assistantId: context.assistantId ?? context.currentAssistantId ?? undefined,
    })
    const reuseKey = reusableApprovalKey(tc, context)
    const taskKey = taskApprovalKey(tc, context)
    if (decision === 'approve_for_task' && taskKey) rememberTaskApproval(taskKey)
    else if (reuseKey) rememberReusableApproval(reuseKey)
    const result = await executeSingle(tc, buildApprovedExecutionContext(tc, context), store)
    results.push(result)
    pending.delete(tc.id)
    if (result.result.status === 'success') {
      completed.add(tc.id)
    } else {
      failed.add(tc.id)
    }
  }

  // 确保所有工具状态已更新并重置流状态
  if (!abortSignal?.aborted) {
    // 重置流状态为 streaming（移除 tool_running 状态）
    store.setStreamState({
      phase: 'streaming',
      currentToolCall: undefined,
      statusText: undefined,
      requestId: context.requestId,
      assistantId: context.assistantId ?? context.currentAssistantId ?? undefined,
    })
  }

  return { results, hadRejectedTool }
}
