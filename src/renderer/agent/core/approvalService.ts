export type ApprovalDecision = 'approve' | 'approve_for_task' | 'reject'

class ApprovalServiceClass {
  private pendingResolves = new Map<string, {
    requestId: string
    toolCallId?: string
    resolve: (decision: ApprovalDecision) => void
  }>()
  private queuedDecisions = new Map<string, ApprovalDecision>()

  private key(requestId: string, toolCallId?: string): string {
    return `${requestId}:${toolCallId || 'current'}`
  }

  async waitForApproval(requestId?: string, toolCallId?: string): Promise<ApprovalDecision> {
    const id = requestId || crypto.randomUUID()
    const key = this.key(id, toolCallId)
    const queued = this.queuedDecisions.get(key)
    if (queued) {
      this.queuedDecisions.delete(key)
      return queued
    }

    return new Promise((resolve) => {
      this.pendingResolves.set(key, { requestId: id, toolCallId, resolve })
    })
  }

  private decide(decision: ApprovalDecision, requestId?: string, toolCallId?: string): void {
    if (requestId && toolCallId) {
      const key = this.key(requestId, toolCallId)
      const pending = this.pendingResolves.get(key)
      if (pending) {
        pending.resolve(decision)
        this.pendingResolves.delete(key)
      } else if (!this.queuedDecisions.has(key)) {
        this.queuedDecisions.set(key, decision)
      }
      return
    }

    const lastKey = Array.from(this.pendingResolves.entries())
      .filter(([, pending]) => !requestId || pending.requestId === requestId)
      .map(([key]) => key)
      .pop()
    if (lastKey) {
      this.pendingResolves.get(lastKey)?.resolve(decision)
      this.pendingResolves.delete(lastKey)
    }
  }

  approve(requestId?: string, toolCallId?: string): void {
    this.decide('approve', requestId, toolCallId)
  }

  approveForTask(requestId?: string, toolCallId?: string): void {
    this.decide('approve_for_task', requestId, toolCallId)
  }

  reject(requestId?: string, toolCallId?: string): void {
    this.decide('reject', requestId, toolCallId)
  }

  /**
   * 任务收尾清理：把该请求遗留的 pending 审批结算为 reject，并丢弃无人
   * 消费的排队决策。
   *
   * 正常流程里 waitForApproval 都会被 decide 精确结算；这里兜底的是异常
   * 路径（循环抛错、中止时 requestId 无法解析等）。若不清理，
   * pendingResolves / queuedDecisions 会随线程数单调增长，且挂起的
   * executeTools 会永远等待。
   */
  clearRequest(requestId?: string): number {
    let cleared = 0
    for (const [key, pending] of this.pendingResolves) {
      if (!requestId || pending.requestId === requestId) {
        pending.resolve('reject')
        this.pendingResolves.delete(key)
        cleared++
      }
    }
    const prefix = requestId ? `${requestId}:` : null
    for (const key of this.queuedDecisions.keys()) {
      if (!prefix || key.startsWith(prefix)) {
        this.queuedDecisions.delete(key)
        cleared++
      }
    }
    return cleared
  }
}

export const approvalService = new ApprovalServiceClass()
