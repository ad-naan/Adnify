/**
 * 工具执行状态判定测试
 *
 * 覆盖的是「成败到底怎么判定」。原来下游靠 `content.startsWith('Error:')` 反推，
 * 有两类必然错判：
 *
 *   1. 工具成功，但输出恰好以 "Error:" 开头 —— 编译器日志、grep 命中了含
 *      "Error:" 的那一行、run_command 的 stderr 被 truncate 到头部正好是错误行。
 *      这些都是成功的工具调用，却被记成失败。
 *   2. 'Rejected by user' / 'Skipped: dependency not met' 不以 "Error:" 开头，
 *      于是被记成成功 —— 用户明确拒绝的操作被当成执行成功了。
 *
 * 两种错判都会流进 loopDetector 的 failureRate，进而影响循环检测。
 * 现在 status 由产生结果的地方显式声明，所以这些测试断言 status 而不是文案。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { executeTools } from '@renderer/agent/core/tools'
import { useAgentStore } from '@renderer/agent/store/AgentStore'
import type { ToolCall } from '@shared/types'
import type { ToolExecutionContext } from '@renderer/agent/core/types'

/** 每个用例自己决定 toolManager 返回什么 */
let mockExecuteImpl: (name: string, args: any) => Promise<any> = async (name: string) => ({
  success: true,
  result: `Result from ${name}`,
  meta: {},
})

vi.mock('@renderer/agent/tools/providers', () => ({
  toolManager: {
    execute: vi.fn((name: string, args: any) => mockExecuteImpl(name, args)),
  },
}))

vi.mock('@renderer/agent/tools/registry', () => ({
  toolRegistry: {
    execute: vi.fn(async () => ({ success: true, result: 'ok' })),
  },
}))

vi.mock('@utils/Logger', () => ({
  logger: {
    agent: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}))

vi.mock('@store', () => ({
  useStore: {
    getState: vi.fn(() => ({
      // needsApproval 读的是顶层 autoApprove（不是 agentConfig.autoApprove），
      // 这里全开，让 run_command 之类的工具走无审批的并行路径。
      autoApprove: { terminal: true, dangerous: true },
      agentConfig: { autoApprove: true },
      addToolCallLog: vi.fn(),
    })),
  },
}))

describe('工具执行状态判定', () => {
  let threadId: string
  let context: ToolExecutionContext

  function getStore() {
    return useAgentStore.getState().forThread(threadId)
  }

  beforeEach(() => {
    useAgentStore.setState({ threads: {}, currentThreadId: null })
    const store = useAgentStore.getState()
    threadId = store.createThread()
    const assistantId = store.addAssistantMessage()
    context = { workspacePath: '/test/workspace', currentAssistantId: assistantId }

    mockExecuteImpl = async (name: string) => ({
      success: true,
      result: `Result from ${name}`,
      meta: {},
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('成功的工具：输出以 "Error:" 开头也必须判成 success', async () => {
    // 这是错判 #1。真实场景：run_command 跑构建，编译器把错误打到 stdout，
    // 命令本身退出码 0（比如 `tsc --noEmit || true`），工具执行是成功的。
    mockExecuteImpl = async () => ({
      success: true,
      result: 'Error: TS2304: Cannot find name \'foo\'.\n  at src/a.ts:12',
      meta: {},
    })

    const toolCalls: ToolCall[] = [
      { id: 'tc1', name: 'run_command', arguments: { command: 'tsc' }, status: 'success' },
    ]
    const { results } = await executeTools(toolCalls, context, getStore())

    expect(results).toHaveLength(1)
    expect(results[0].result.status).toBe('success')
    // 内容原样保留，不因为判定而被改写
    expect(results[0].result.content).toContain('TS2304')
  })

  it('grep 命中含 "Error:" 的行：仍然是 success', async () => {
    mockExecuteImpl = async () => ({
      success: true,
      result: 'Error: handler.ts:88: throw new Error("Error: bad input")',
      meta: {},
    })

    const { results } = await executeTools(
      [{ id: 'tc1', name: 'grep_search', arguments: { pattern: 'Error' }, status: 'success' }],
      context,
      getStore(),
    )

    expect(results[0].result.status).toBe('success')
  })

  it('真正失败的工具：status 是 error', async () => {
    mockExecuteImpl = async () => ({
      success: false,
      error: 'ENOENT: no such file or directory',
    })

    const { results } = await executeTools(
      [{ id: 'tc1', name: 'read_file', arguments: { path: 'nope.txt' }, status: 'success' }],
      context,
      getStore(),
    )

    expect(results[0].result.status).toBe('error')
    expect(results[0].result.content).toContain('ENOENT')
  })

  it('工具抛异常：status 是 error', async () => {
    mockExecuteImpl = async () => {
      throw new Error('boom')
    }

    const { results } = await executeTools(
      [{ id: 'tc1', name: 'read_file', arguments: { path: 'a.txt' }, status: 'success' }],
      context,
      getStore(),
    )

    expect(results[0].result.status).toBe('error')
  })

  it('返回空字符串的成功工具：不能因为「没内容」被判失败', async () => {
    // grep 没匹配到、list_directory 空目录，都是合法的成功返回
    mockExecuteImpl = async () => ({ success: true, result: '', meta: {} })

    const { results } = await executeTools(
      [{ id: 'tc1', name: 'grep_search', arguments: { pattern: 'zzz' }, status: 'success' }],
      context,
      getStore(),
    )

    expect(results[0].result.status).toBe('success')
  })

  it('每条结果都带 status，下游不需要再猜', async () => {
    // 混合成败，确保并行路径上每个结果都被显式标注
    mockExecuteImpl = async (name: string) =>
      name === 'read_file'
        ? { success: false, error: 'nope' }
        : { success: true, result: 'ok', meta: {} }

    const { results } = await executeTools(
      [
        { id: 'tc1', name: 'read_file', arguments: { path: 'a.txt' }, status: 'success' },
        { id: 'tc2', name: 'list_directory', arguments: { path: '.' }, status: 'success' },
      ],
      context,
      getStore(),
    )

    expect(results).toHaveLength(2)
    for (const r of results) {
      expect(['success', 'error', 'rejected', 'skipped']).toContain(r.result.status)
    }
    expect(results.find(r => r.toolCall.id === 'tc1')!.result.status).toBe('error')
    expect(results.find(r => r.toolCall.id === 'tc2')!.result.status).toBe('success')
  })
})
