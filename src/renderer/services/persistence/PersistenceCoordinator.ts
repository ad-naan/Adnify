export type PersistenceScope = 'workspace' | 'application'
export type PersistenceFlushReason = 'idle' | 'critical' | 'workspace-switch' | 'shutdown'

export interface PersistenceParticipant {
  id: string
  scope: PersistenceScope
  flush: (reason: PersistenceFlushReason) => Promise<void>
}

class PersistenceCoordinator {
  private readonly participants = new Map<string, PersistenceParticipant>()

  register(participant: PersistenceParticipant): () => void {
    // Replacement is intentional for renderer hot reloads. The id remains the
    // stable lifecycle identity while the implementation instance is refreshed.
    this.participants.set(participant.id, participant)
    return () => {
      if (this.participants.get(participant.id) === participant) {
        this.participants.delete(participant.id)
      }
    }
  }

  async flush(
    reason: PersistenceFlushReason,
    scope?: PersistenceScope,
  ): Promise<void> {
    const selected = [...this.participants.values()]
      .filter(participant => !scope || participant.scope === scope)

    const results = await Promise.allSettled(
      selected.map(participant => participant.flush(reason)),
    )
    const failures = results.flatMap((result, index) =>
      result.status === 'rejected'
        ? [`${selected[index].id}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
        : [],
    )
    if (failures.length > 0) {
      throw new Error(`Persistence flush failed (${reason}): ${failures.join('; ')}`)
    }
  }
}

export const persistenceCoordinator = new PersistenceCoordinator()
