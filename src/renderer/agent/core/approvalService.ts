export type ApprovalDecision = 'approve' | 'approve_for_task' | 'reject'

class ApprovalServiceClass {
  private pendingResolves = new Map<string, (decision: ApprovalDecision) => void>()

  async waitForApproval(requestId?: string): Promise<ApprovalDecision> {
    const id = requestId || crypto.randomUUID()
    return new Promise((resolve) => {
      this.pendingResolves.set(id, resolve)
    })
  }

  approve(requestId?: string): void {
    if (requestId) {
      this.pendingResolves.get(requestId)?.('approve')
      this.pendingResolves.delete(requestId)
      return
    }

    const lastKey = Array.from(this.pendingResolves.keys()).pop()
    if (lastKey) {
      this.pendingResolves.get(lastKey)?.('approve')
      this.pendingResolves.delete(lastKey)
    }
  }

  approveForTask(requestId?: string): void {
    if (requestId) {
      this.pendingResolves.get(requestId)?.('approve_for_task')
      this.pendingResolves.delete(requestId)
      return
    }

    const lastKey = Array.from(this.pendingResolves.keys()).pop()
    if (lastKey) {
      this.pendingResolves.get(lastKey)?.('approve_for_task')
      this.pendingResolves.delete(lastKey)
    }
  }

  reject(requestId?: string): void {
    if (requestId) {
      this.pendingResolves.get(requestId)?.('reject')
      this.pendingResolves.delete(requestId)
      return
    }

    const lastKey = Array.from(this.pendingResolves.keys()).pop()
    if (lastKey) {
      this.pendingResolves.get(lastKey)?.('reject')
      this.pendingResolves.delete(lastKey)
    }
  }
}

export const approvalService = new ApprovalServiceClass()
