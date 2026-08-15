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
    expect(await first).toBe(false)

    // The unrelated thread's approval must still be pending; settle it here so
    // the promise does not dangle.
    approvalService.approve('req-thread-b')
    expect(await second).toBe(true)
  })

  it('falls back to the most recent pending approval when no id is given', async () => {
    const older = approvalService.waitForApproval('req-older')
    const newer = approvalService.waitForApproval('req-newer')

    // This is the cross-thread hazard: an abort that cannot resolve its own
    // requestId silently rejects whichever approval registered last.
    approvalService.reject()
    expect(await newer).toBe(false)

    approvalService.approve('req-older')
    expect(await older).toBe(true)
  })

  it('is a no-op when the requestId has no pending approval', async () => {
    const pending = approvalService.waitForApproval('req-live')

    // Aborting with a stale id must not touch an unrelated live approval.
    approvalService.reject('req-already-gone')

    approvalService.approve('req-live')
    expect(await pending).toBe(true)
  })
})
