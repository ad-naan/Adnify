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
import { getToolApprovalType, isFileEditTool, needsFileSnapshot } from '@/shared/config/tools'
import { pathStartsWith, joinPath } from '@shared/utils/pathUtils'
import { useStore } from '@store'
import { EventBus } from './EventBus'
import { truncateToolResult } from '@/renderer/utils/partialJson'
import { getAgentConfig } from '../utils/AgentConfig'
import type { ToolCall } from '@/shared/types'
import type { ToolExecutionContext, AgentToolExecutionResult } from './types'
import { approvalService } from './approvalService'
import { useAgentStore } from '../store/AgentStore'
import { buildExecutionBatches } from './toolExecutionPlan'
import { streamingEditService } from '../services/streamingEditService'
import { resolveStreamingEditFilePath } from '../services/streamingEditPreview'
import { shellServerRoutingService } from '../services/shellServerRoutingService'

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
function needsApproval(toolName: string): boolean {
  const approvalType = getToolApprovalType(toolName)

  // 如果工具本身不需要审批，直接返回 false
  if (approvalType === 'none') return false

  // 检查用户的 autoApprove 设置
  const mainStore = useStore.getState()
  const autoApprove = mainStore.autoApprove

  // 根据工具类型检查对应的 autoApprove 设置
  if (approvalType === 'terminal' && autoApprove?.terminal) {
    return false // 终端命令已设置自动批准
  }

  if (approvalType === 'dangerous' && autoApprove?.dangerous) {
    return false // 危险操作已设置自动批准
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
    const result = await toolManager.execute(
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
      }
    )

    const duration = Date.now() - startTime

    const rawContent = result.success
      ? (result.result !== undefined && result.result !== null ? result.result : 'Success')
      : `Error: ${result.error || 'Unknown error'}`

    // 截断过长的工具结果（防止单轮对话过长）
    const config = getAgentConfig()
    const content = truncateToolResult(rawContent, toolCall.name, config.maxToolResultChars)

    if (content.length < rawContent.length) {
      logger.agent.info(`[Tools] Truncated ${toolCall.name} result: ${rawContent.length} -> ${content.length} chars`)
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
    const richContent = result.richContent
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
    const errorMsg = error instanceof Error ? error.message : String(error)
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
): Promise<{ results: AgentToolExecutionResult[]; userRejected: boolean }> {
  const results: AgentToolExecutionResult[] = []
  let userRejected = false

  if (toolCalls.length === 0) {
    return { results, userRejected }
  }

  // 分析依赖
  const deps = analyzeToolDependencies(toolCalls)
  const completed = new Set<string>()
  const rejected = new Set<string>()
  const failed = new Set<string>()
  const pending = new Set(toolCalls.map(tc => tc.id))

  // 分离需要审批和不需要审批的工具
  const approvalRequired = toolCalls.filter(tc => needsApproval(tc.name))
  const noApprovalRequired = toolCalls.filter(tc => !needsApproval(tc.name))

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
            const result = await executeSingle(tc, context, store)
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

    // 设置当前工具为待审批状态
    store.setStreamState({
      phase: 'tool_pending',
      currentToolCall: tc,
      statusText: undefined,
      requestId: context.requestId,
      assistantId: context.assistantId ?? context.currentAssistantId ?? undefined,
    })
    const pendingArguments = await enrichToolArgumentsWithRoutingMeta(tc, context)
    if (context.currentAssistantId) {
      store.updateToolCall(context.currentAssistantId, tc.id, {
        arguments: pendingArguments,
        status: 'awaiting',
      })
    }
    emitToolEvent({
      type: 'tool:pending',
      id: tc.id,
      name: tc.name,
      args: pendingArguments,
      ...buildToolExecutionIdentity(tc, context),
    })

    // 等待用户审批
    const approved = await approvalService.waitForApproval(context.requestId)

    if (!approved || abortSignal?.aborted) {
      // 用户拒绝了这个工具
      userRejected = true
      rejected.add(tc.id)
      if (context.currentAssistantId) {
        store.updateToolCall(context.currentAssistantId, tc.id, {
          status: 'rejected',
          streamingState: undefined,
        })
      }
      emitToolEvent({ type: 'tool:rejected', id: tc.id, ...buildToolExecutionIdentity(tc, context) })
      results.push({ toolCall: tc, result: { content: 'Rejected by user', status: 'rejected' } })
      pending.delete(tc.id)

      // 继续处理下一个工具，而不是中断整个流程
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
    const result = await executeSingle(tc, context, store)
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

  return { results, userRejected }
}
