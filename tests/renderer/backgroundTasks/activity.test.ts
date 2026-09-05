import { describe, expect, it } from 'vitest'
import { projectBackgroundActivity } from '@renderer/backgroundTasks/activity'

type Thread = Parameters<typeof projectBackgroundActivity>[0][string]
type Plan = Parameters<typeof projectBackgroundActivity>[1][number]
const thread = (id: string, phase: Thread['streamState']['phase'] = 'idle', extra: Partial<Thread> = {}): Thread => ({
  id, streamState: { phase }, isCompacting: false, ...extra,
})
const plan = (status: Plan['status'] = 'executing'): Plan => ({
  id: 'plan', status, tasks: [{ id: 'a', status: 'completed' }, { id: 'b', status: 'running', threadId: 'b' }],
})

describe('background activity projection', () => {
  it('counts all conversations and leaves unmeasurable work indeterminate', () => {
    expect(projectBackgroundActivity({ visible: thread('visible'), background: thread('background', 'streaming') }, []))
      .toEqual({ state: 'running' })
  })
  it('releases work during approval even while loop metadata still says running', () => {
    const pending = thread('b', 'tool_pending', { executionMeta: { loopState: 'running' } })
    expect(projectBackgroundActivity({ b: pending }, [plan()])).toEqual({ state: 'paused', progress: 0.5 })
    expect(projectBackgroundActivity({ b: pending, c: thread('c', 'tool_running') }, [plan()])).toEqual({ state: 'running' })
  })
  it('releases during user input but keeps a concurrent compaction awake', () => {
    const waiting = thread('a', 'idle', { executionMeta: { loopState: 'waiting_for_user' } })
    expect(projectBackgroundActivity({ a: waiting }, [])).toEqual({ state: 'paused' })
    expect(projectBackgroundActivity({ a: waiting, b: thread('b', 'idle', { isCompacting: true }) }, [])).toEqual({ state: 'running' })
  })
  it.each(['completed', 'failed', 'aborted'] as const)('ignores stale streaming phase after %s', loopState => {
    expect(projectBackgroundActivity({ a: thread('a', 'streaming', { executionMeta: { loopState } }) }, []))
      .toEqual({ state: 'idle' })
  })
  it('uses plan task completion, including skipped tasks, rather than elapsed time', () => {
    const current = plan()
    current.tasks[0].status = 'skipped'
    expect(projectBackgroundActivity({ b: thread('b', 'streaming') }, [current])).toEqual({ state: 'running', progress: 0.5 })
  })
  it('keeps running while a pause/stop is draining active work', () => {
    for (const status of ['pausing', 'stopping'] as const) {
      expect(projectBackgroundActivity({ b: thread('b', 'tool_running') }, [plan(status)]))
        .toEqual({ state: 'running', progress: 0.5 })
    }
    expect(projectBackgroundActivity({}, [plan('paused')])).toEqual({ state: 'paused', progress: 0.5 })
    expect(projectBackgroundActivity({}, [plan('stopped')])).toEqual({ state: 'idle' })
  })
  it('shows only recent failures, never errors from historical conversations', () => {
    const threads = { a: thread('a', 'error') }
    expect(projectBackgroundActivity(threads, [])).toEqual({ state: 'idle' })
    expect(projectBackgroundActivity(threads, [], true)).toEqual({ state: 'error' })
    expect(projectBackgroundActivity({ ...threads, b: thread('b', 'streaming') }, [], true)).toEqual({ state: 'running' })
  })
  it('counts plan-owned child execution within plan progress', () => {
    const threads = { b: thread('b'), child: thread('child', 'streaming', { parentThreadId: 'b' }) }
    expect(projectBackgroundActivity(threads, [plan()])).toEqual({ state: 'running', progress: 0.5 })
  })
})
