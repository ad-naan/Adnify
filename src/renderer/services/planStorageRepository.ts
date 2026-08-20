import type { TaskPlan } from '@renderer/agent/plan/types'
import { api } from './electronAPI'
import { persistenceCoordinator } from './persistence/PersistenceCoordinator'

const COMMIT_DELAY_MS = 120

class PlanStorageRepository {
  private readonly pending = new Map<string, TaskPlan>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private commitChain: Promise<void> = Promise.resolve()

  stage(plan: TaskPlan): void {
    this.pending.set(plan.id, plan)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush().catch(error => {
        console.warn('[PlanStorage] Deferred SQLite flush failed; queued plans will be retried', error)
      })
    }, COMMIT_DELAY_MS)
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.commitChain.then(operation, operation)
    // Keep the queue usable after a failed operation while still propagating
    // this operation's failure to its caller.
    this.commitChain = result.catch(() => undefined)
    return result
  }

  async delete(planId: string): Promise<void> {
    this.pending.delete(planId)
    await this.flush()
    await this.enqueue(async () => {
      await api.session.deletePlan(planId)
    })
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.pending.size > 0) {
      const batch = [...this.pending.values()]
      this.pending.clear()
      try {
        await this.enqueue(async () => {
          for (const plan of batch) await api.session.upsertPlan(plan)
        })
      } catch (error) {
        // Preserve a newer staged revision if one arrived while this batch was
        // being committed; otherwise restore the failed item for the next flush.
        for (const plan of batch) {
          const queued = this.pending.get(plan.id)
          if (!queued || (queued.revision || 0) < (plan.revision || 0)) {
            this.pending.set(plan.id, plan)
          }
        }
        throw error
      }
    }
    await this.commitChain
    if (this.pending.size > 0) await this.flush()
  }
}

export const planStorageRepository = new PlanStorageRepository()

persistenceCoordinator.register({
  id: 'task-plans',
  scope: 'workspace',
  flush: () => planStorageRepository.flush(),
})
