import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionLaneAssignment } from '@/renderer/agent/orchestration/ExecutionLaneCoordinator'
import type { SubAgentRequest, SubAgentStartedInfo } from '@/renderer/agent/orchestration/types'

const harness = vi.hoisted(() => ({
  send: vi.fn(),
  abort: vi.fn(),
  acquire: vi.fn(),
  complete: vi.fn(),
  release: vi.fn(),
  store: {
    threads: {} as Record<string, { messages: { id: string; role: string; content: string }[]; rootThreadId?: string }>,
    createThread: vi.fn(),
    renameThread: vi.fn(),
  },
}))

vi.mock('@/renderer/agent/core/Agent', () => ({ Agent: { send: harness.send, abort: harness.abort } }))
vi.mock('@/renderer/agent/store/AgentStore', () => ({ useAgentStore: { getState: () => harness.store } }))
vi.mock('@/renderer/agent/orchestration/ExecutionLaneCoordinator', () => ({
  ExecutionLaneCoordinator: { acquire: harness.acquire, complete: harness.complete, release: harness.release },
}))
vi.mock('@utils/Logger', () => ({ logger: { agent: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } }))

import { EventBus } from '@/renderer/agent/core/EventBus'
import { SubAgentManager } from '@/renderer/agent/orchestration/SubAgentManager'

const lane: ExecutionLaneAssignment = {
  isolated: true,
  workspacePath: 'D:/repo/.adnify/worktrees/task-12345678',
  lane: {
    id: '12345678', workspacePath: 'D:/repo', path: 'D:/repo/.adnify/worktrees/task-12345678',
    branch: 'adnify/lane-task-12345678', baseBranch: 'main', baseCommit: 'base000',
  },
}
const DEFAULT_TIMEOUT = 300000
const ABORT_GRACE = 5000
let executions: Map<string, { requestId: string; assistantId: string; stop: () => void }>

async function start(request: Partial<SubAgentRequest> = {}, signal?: AbortSignal) {
  let info!: SubAgentStartedInfo
  const result = SubAgentManager.spawn(
    { description: 'inspect task', ...request }, {} as never, 'D:/repo', 'agent', 'parent-thread',
    { onStarted: started => { info = started }, abortSignal: signal },
  )
  await vi.advanceTimersByTimeAsync(0)
  expect(info).toBeDefined()
  return { info, result }
}

function end(info: SubAgentStartedInfo, reason: 'complete' | 'error' | 'aborted' = 'complete', error?: string) {
  const execution = executions.get(info.threadId)!
  EventBus.emit({ type: 'loop:end', reason, error, threadId: info.threadId, requestId: info.requestId, assistantId: execution.assistantId })
  execution.stop()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  EventBus.clear()
  harness.store.threads = {}
  executions = new Map()
  let nextThread = 0
  harness.store.createThread.mockImplementation(() => {
    const id = `sub-thread-${++nextThread}`
    harness.store.threads[id] = { messages: [] }
    return id
  })
  harness.acquire.mockReset().mockResolvedValue({ isolated: false, workspacePath: 'D:/repo' })
  harness.complete.mockReset().mockResolvedValue({ ...lane.lane, success: true, outcome: 'merged', archived: true })
  harness.release.mockReset().mockResolvedValue({ ...lane.lane, success: false, outcome: 'retained', archived: true, notice: { code: 'keptForRecovery' } })
  harness.send.mockReset().mockImplementation((_message, _config, _workspace, _mode, _prompt, options) => {
    const assistantId = `assistant-${options.threadId}`
    harness.store.threads[options.threadId].messages.push({ id: assistantId, role: 'assistant', content: 'task answer' })
    return new Promise(resolve => {
      executions.set(options.threadId, {
        requestId: options.requestId, assistantId,
        stop: () => resolve({ threadId: options.threadId, requestId: options.requestId, assistantId }),
      })
    })
  })
  harness.abort.mockReset().mockImplementation((threadId: string) => {
    const execution = executions.get(threadId)
    if (!execution) return
    // Deliberately synchronous: cancellation must claim the terminal state first.
    EventBus.emit({ type: 'loop:end', reason: 'aborted', threadId, requestId: execution.requestId, assistantId: execution.assistantId })
    execution.stop()
  })
})

afterEach(async () => {
  for (const execution of executions.values()) execution.stop()
  SubAgentManager.abortAll()
  await vi.advanceTimersByTimeAsync(ABORT_GRACE)
  EventBus.clear()
  vi.useRealTimers()
})

describe('SubAgentManager lifecycle', () => {
  it('refreshes inactivity from stream progress rather than killing a healthy long response', async () => {
    const task = await start()
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT - 1)
      EventBus.emit({ type: 'stream:activity', threadId: task.info.threadId, requestId: task.info.requestId })
    }
    expect(harness.abort).not.toHaveBeenCalled()
    end(task.info)
    await expect(task.result).resolves.toMatchObject({ success: true, output: 'task answer', assistantId: `assistant-${task.info.threadId}` })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not let another thread keep an inactive sub-agent alive', async () => {
    const task = await start()
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT - 1)
    EventBus.emit({ type: 'stream:activity', threadId: 'unrelated-thread', requestId: 'other-request' })
    await vi.advanceTimersByTimeAsync(1)
    await expect(task.result).resolves.toMatchObject({ success: false, error: expect.stringContaining('300000ms of inactivity') })
    expect(harness.abort).toHaveBeenCalledExactlyOnceWith(task.info.threadId)
  })

  it('preserves a timeout cause and releases an isolated lane exactly once despite synchronous abort events', async () => {
    harness.acquire.mockResolvedValue(lane)
    const task = await start({ writeCapable: true, concurrent: true })
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT)
    const result = await task.result
    expect(result.success).toBe(false)
    expect(result.error).toContain('timed out')
    expect(result.error).not.toContain('was aborted')
    expect(result.worktree).toMatchObject({ status: 'ready', branch: lane.lane!.branch })
    expect(harness.release).toHaveBeenCalledTimes(1)
    expect(harness.complete).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('returns on timeout even when Agent.send never stops and leaves its lane untouched', async () => {
    harness.acquire.mockResolvedValue(lane)
    harness.abort.mockImplementation(() => {})
    const task = await start({ writeCapable: true, concurrent: true })
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT + ABORT_GRACE)
    const result = await task.result
    expect(result.error).toContain('timed out')
    expect(result.error).toContain('Execution did not stop')
    expect(result.worktree).toMatchObject({ status: 'failed', archived: false, notice: { code: 'laneStillRunning' } })
    expect(harness.release).not.toHaveBeenCalled()
    expect(harness.complete).not.toHaveBeenCalled()
    expect(SubAgentManager.getActiveSubAgents()).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('waits for execution to stop before releasing the worktree', async () => {
    harness.acquire.mockResolvedValue(lane)
    harness.abort.mockImplementation(() => {})
    const task = await start({ writeCapable: true, concurrent: true })
    SubAgentManager.abort(task.info.subAgentId)
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.release).not.toHaveBeenCalled()
    executions.get(task.info.threadId)!.stop()
    await task.result
    expect(harness.release).toHaveBeenCalledTimes(1)
  })

  it('keeps the absolute 30-minute cap even with continuous progress', async () => {
    const task = await start()
    for (let minute = 0; minute < 29; minute++) {
      await vi.advanceTimersByTimeAsync(60000)
      EventBus.emit({ type: 'stream:activity', threadId: task.info.threadId, requestId: task.info.requestId })
    }
    await vi.advanceTimersByTimeAsync(60000)
    await expect(task.result).resolves.toMatchObject({ success: false, error: expect.stringContaining('maximum duration') })
    expect(harness.abort).toHaveBeenCalledTimes(1)
  })

  it('cancels only the sub-agent belonging to the cancelled parent', async () => {
    const parent = new AbortController()
    const first = await start({}, parent.signal)
    const second = await start()
    parent.abort()
    await expect(first.result).resolves.toMatchObject({ success: false, error: expect.stringContaining('parent task was cancelled') })
    expect(harness.abort).toHaveBeenCalledExactlyOnceWith(first.info.threadId)
    end(second.info)
    await expect(second.result).resolves.toMatchObject({ success: true })
  })

  it('does not dispatch for an already-cancelled parent', async () => {
    const parent = new AbortController()
    parent.abort()
    const result = await SubAgentManager.spawn({ description: 'task' }, {} as never, 'D:/repo', 'agent', 'parent', { abortSignal: parent.signal })
    expect(result.error).toContain('parent task was cancelled')
    expect(harness.acquire).not.toHaveBeenCalled()
    expect(harness.send).not.toHaveBeenCalled()
  })

  it('releases a newly-created lane if the parent cancels during acquisition', async () => {
    const parent = new AbortController()
    harness.acquire.mockImplementation(async () => { parent.abort(); return lane })
    const result = await SubAgentManager.spawn({ description: 'task' }, {} as never, 'D:/repo', 'agent', 'parent', { abortSignal: parent.signal })
    expect(result.success).toBe(false)
    expect(harness.release).toHaveBeenCalledTimes(1)
    expect(harness.send).not.toHaveBeenCalled()
    expect(harness.abort).not.toHaveBeenCalled()
  })

  it('handles synchronous onStarted cancellation before dispatch without aborting unrelated work', async () => {
    const result = await SubAgentManager.spawn({ description: 'task' }, {} as never, 'D:/repo', 'agent', 'parent', {
      onStarted: info => SubAgentManager.abort(info.subAgentId),
    })
    expect(result.error).toContain('cancelled by user')
    expect(harness.send).not.toHaveBeenCalled()
    expect(harness.abort).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the actual model error in the task result', async () => {
    const task = await start()
    end(task.info, 'error', 'Provider rate limit exceeded (429)')
    await expect(task.result).resolves.toMatchObject({ success: false, error: 'Provider rate limit exceeded (429)' })
  })

  it('preserves output and recovery metadata when a dirty base prevents automatic merge', async () => {
    harness.acquire.mockResolvedValue(lane)
    harness.complete.mockResolvedValue({ ...lane.lane, success: false, outcome: 'retained', archived: true, notice: { code: 'dirtyBaseMerge' } })
    const task = await start({ writeCapable: true, concurrent: true })
    end(task.info)
    await expect(task.result).resolves.toMatchObject({ success: true, output: 'task answer', worktree: { status: 'ready', notice: { code: 'dirtyBaseMerge' } } })
    expect(harness.release).not.toHaveBeenCalled()
  })

  it('ignores duplicate terminal events while the lane is being finalized', async () => {
    harness.acquire.mockResolvedValue(lane)
    let resolveMerge!: (value: unknown) => void
    harness.complete.mockImplementation(() => new Promise(resolve => { resolveMerge = resolve }))
    const task = await start({ writeCapable: true, concurrent: true })
    end(task.info)
    await vi.advanceTimersByTimeAsync(0)
    end(task.info, 'aborted')
    SubAgentManager.abort(task.info.subAgentId)
    expect(harness.release).not.toHaveBeenCalled()
    expect(harness.complete).toHaveBeenCalledTimes(1)
    resolveMerge({ ...lane.lane, success: true, outcome: 'merged', archived: true })
    await expect(task.result).resolves.toMatchObject({ success: true })
  })

  it('reports unexpected lane finalization errors rather than hanging without a result', async () => {
    harness.acquire.mockResolvedValue(lane)
    harness.complete.mockRejectedValue(new Error('commit operation failed'))
    const task = await start({ writeCapable: true, concurrent: true })
    end(task.info)
    await expect(task.result).resolves.toMatchObject({ success: false, error: expect.stringContaining('commit operation failed'), worktree: { archived: false } })
    expect(harness.release).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports startup failures immediately and cleans up only once', async () => {
    harness.acquire.mockResolvedValue(lane)
    harness.send.mockRejectedValue(new Error('missing provider credentials'))
    const task = await start({ writeCapable: true, concurrent: true })
    await expect(task.result).resolves.toMatchObject({ success: false, error: expect.stringContaining('missing provider credentials') })
    expect(harness.release).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
