class ApprovalServiceClass {
  private pendingResolves = new Map<string, (approved: boolean) => void>()

  async waitForApproval(requestId?: string): Promise<boolean> {
    const id = requestId || crypto.randomUUID()
    return new Promise((resolve) => {
      this.pendingResolves.set(id, resolve)
    })
  }

  approve(requestId?: string): void {
    if (requestId) {
      this.pendingResolves.get(requestId)?.(true)
      this.pendingResolves.delete(requestId)
      return
    }

    const lastKey = Array.from(this.pendingResolves.keys()).pop()
    if (lastKey) {
      this.pendingResolves.get(lastKey)?.(true)
      this.pendingResolves.delete(lastKey)
    }
  }

  reject(requestId?: string): void {
    if (requestId) {
      this.pendingResolves.get(requestId)?.(false)
      this.pendingResolves.delete(requestId)
      return
    }

    const lastKey = Array.from(this.pendingResolves.keys()).pop()
    if (lastKey) {
      this.pendingResolves.get(lastKey)?.(false)
      this.pendingResolves.delete(lastKey)
    }
  }
}

export const approvalService = new ApprovalServiceClass()
