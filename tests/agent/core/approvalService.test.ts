import { describe, it, expect } from 'vitest'
import { approvalService } from '@/renderer/agent/core/approvalService'

/**
 * `Agent.abort()` resolved two different request ids: `api.llm.abort()` got one
 * built from `runningTasks` / `streamState`, while `approvalService.reject()`
 * got `executionMeta.requestId`. When those diverged — or when the second was
 * undefined — the abort cancelled one request while rejecting the approval of
 * another.
 *
 * The undefined case is the dangerous one: `reject(undefined)` falls back to the
 * most recently registered key, which under sub-agents or plan-task threads
 * belongs to a *different* thread. These tests pin that behaviour so the
 * fallback stays a deliberate choice rather than an accident.
 */
describe('approvalService request targeting', () => {
  it('rejects only the approval matching the given requestId', async () => {
    const first = approvalService.waitForApproval('req-thread-a')
    const second = approvalService.waitForApproval('req-thread-b')

    approvalService.reject('req-thread-a')
    expect(await first).toBe('reject')

    // The unrelated thread's approval must still be pending; settle it here so
    // the promise does not dangle.
    approvalService.approve('req-thread-b')
    expect(await second).toBe('approve')
  })

  it('falls back to the most recent pending approval when no id is given', async () => {
    const older = approvalService.waitForApproval('req-older')
    const newer = approvalService.waitForApproval('req-newer')

    // This is the cross-thread hazard: an abort that cannot resolve its own
    // requestId silently rejects whichever approval registered last.
    approvalService.reject()
    expect(await newer).toBe('reject')

    approvalService.approve('req-older')
    expect(await older).toBe('approve')
  })

  it('is a no-op when the requestId has no pending approval', async () => {
    const pending = approvalService.waitForApproval('req-live')

    // Aborting with a stale id must not touch an unrelated live approval.
    approvalService.reject('req-already-gone')

    approvalService.approve('req-live')
    expect(await pending).toBe('approve')
  })

  it('distinguishes task-scoped approval from a normal approval', async () => {
    const pending = approvalService.waitForApproval('req-task-scope')

    approvalService.approveForTask('req-task-scope')

    expect(await pending).toBe('approve_for_task')
  })

  it('queues decisions for later tool calls by toolCallId', async () => {
    approvalService.approve('req-queue', 'tool-later')

    await expect(approvalService.waitForApproval('req-queue', 'tool-later')).resolves.toBe('approve')
  })

  it('clearRequest settles leftover pending approvals as rejected', async () => {
    const leftover = approvalService.waitForApproval('req-leak', 'tool-leak')
    const unrelated = approvalService.waitForApproval('req-live-2', 'tool-live-2')

    const cleared = approvalService.clearRequest('req-leak')
    expect(cleared).toBe(1)
    await expect(leftover).resolves.toBe('reject')

    approvalService.approve('req-live-2', 'tool-live-2')
    await expect(unrelated).resolves.toBe('approve')
  })

  it('clearRequest drops queued decisions nobody will consume', async () => {
    approvalService.approve('req-orphan', 'tool-orphan')

    const cleared = approvalService.clearRequest('req-orphan')
    expect(cleared).toBe(1)

    // 清理后同 key 的新等待不得消费到已丢弃的过期决策
    const pending = approvalService.waitForApproval('req-orphan', 'tool-orphan')
    approvalService.approve('req-orphan', 'tool-orphan')
    await expect(pending).resolves.toBe('approve')
  })
})
