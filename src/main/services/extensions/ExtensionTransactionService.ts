import { randomUUID } from 'crypto'
import {
  extensionApprovalScope,
  isRecentAgentApprovalProof,
} from '@shared/security/executionPolicy'
import type {
  ExtensionApplyRequest,
  ExtensionChangeSet,
  ExtensionOperationResult,
  ExtensionPrepareRequest,
  ExtensionSearchRequest,
  ExtensionSearchResult,
  ExtensionVerification,
  InstalledExtensionSummary,
  ExtensionAuditEventType,
} from '@shared/types/extensions'

export interface PreparedExtension {
  displayName: string
  resolvedVersion?: string
  summary: string
  risk: ExtensionChangeSet['risk']
  credentialRequirements: ExtensionChangeSet['credentialRequirements']
  payload: unknown
}

export interface ExtensionTransactionAdapter {
  search(request: ExtensionSearchRequest): Promise<ExtensionSearchResult[]>
  list(workspacePath?: string | null): Promise<InstalledExtensionSummary[]>
  prepare(request: ExtensionPrepareRequest): Promise<PreparedExtension>
  apply(changeSet: ExtensionChangeSet, payload: unknown): Promise<void>
  verify(changeSet: ExtensionChangeSet, payload: unknown): Promise<ExtensionVerification>
  rollback(changeSet: ExtensionChangeSet, payload: unknown): Promise<void>
  refreshCredentialRequirements?(changeSet: ExtensionChangeSet, payload: unknown): Promise<ExtensionChangeSet['credentialRequirements']>
  redactError?(message: string): string
}

export interface ExtensionAuditSink {
  record(event: ExtensionAuditEventType, changeSet: ExtensionChangeSet, status?: string): Promise<void>
}

interface StoredChangeSet {
  public: ExtensionChangeSet
  payload: unknown
}

const CHANGE_SET_TTL_MS = 10 * 60_000
const MAX_CHANGE_SETS = 256

/**
 * Coordinates extension changes. The renderer only sees opaque change-set IDs;
 * resolved commands, URLs and target paths remain owned by the main process.
 */
export class ExtensionTransactionService {
  private readonly changes = new Map<string, StoredChangeSet>()

  constructor(
    private readonly adapter: ExtensionTransactionAdapter,
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = randomUUID,
    private readonly audit?: ExtensionAuditSink,
  ) {}

  search(request: ExtensionSearchRequest): Promise<ExtensionSearchResult[]> {
    return this.adapter.search(request)
  }

  list(workspacePath?: string | null): Promise<InstalledExtensionSummary[]> {
    return this.adapter.list(workspacePath)
  }

  async prepare(request: ExtensionPrepareRequest): Promise<ExtensionChangeSet> {
    this.prune()
    const prepared = await this.adapter.prepare(request)
    const createdAt = this.now()
    const id = this.createId()
    const changeSet: ExtensionChangeSet = {
      id,
      kind: request.kind,
      source: request.source,
      scope: request.scope,
      ...(request.workspacePath ? { workspacePath: request.workspacePath } : {}),
      displayName: prepared.displayName,
      ...(prepared.resolvedVersion ? { resolvedVersion: prepared.resolvedVersion } : {}),
      summary: prepared.summary,
      risk: prepared.risk,
      state: 'prepared',
      createdAt,
      expiresAt: createdAt + CHANGE_SET_TTL_MS,
      credentialRequirements: prepared.credentialRequirements,
    }
    this.changes.set(id, { public: changeSet, payload: prepared.payload })
    await this.audit?.record('prepared', changeSet)
    this.prune()
    return { ...changeSet }
  }

  get(changeSetId: string): ExtensionChangeSet | undefined {
    const stored = this.changes.get(changeSetId)
    if (!stored) return undefined
    this.expire(stored)
    return { ...stored.public }
  }

  async pendingCredentialChanges(): Promise<ExtensionChangeSet[]> {
    const result: ExtensionChangeSet[] = []
    for (const stored of this.changes.values()) {
      this.expire(stored)
      if (stored.public.state !== 'prepared' || stored.public.credentialRequirements.length === 0) continue
      if (this.adapter.refreshCredentialRequirements) {
        stored.public.credentialRequirements = await this.adapter.refreshCredentialRequirements(stored.public, stored.payload)
      }
      result.push({ ...stored.public, credentialRequirements: stored.public.credentialRequirements.map(item => ({ ...item })) })
    }
    return result
  }

  async apply(request: ExtensionApplyRequest): Promise<ExtensionOperationResult> {
    const stored = this.changes.get(request.changeSetId)
    if (!stored) return { success: false, error: 'Unknown extension change set' }
    this.expire(stored)
    if (stored.public.state !== 'prepared') {
      return { success: false, changeSet: { ...stored.public }, error: `Change set is ${stored.public.state}` }
    }
    if (!isRecentAgentApprovalProof(request.approval, extensionApprovalScope(request.changeSetId), this.now())) {
      return { success: false, changeSet: { ...stored.public }, error: 'Missing, expired, or mismatched approval proof' }
    }
    if (this.adapter.refreshCredentialRequirements) {
      stored.public.credentialRequirements = await this.adapter.refreshCredentialRequirements(stored.public, stored.payload)
    }
    if (stored.public.credentialRequirements.some(item => item.required && !item.configured)) {
      return {
        success: false,
        changeSet: { ...stored.public },
        error: 'This extension requires credentials. Enter the missing values in the extension credential prompt, then apply this prepared change set again before it expires.',
      }
    }

    stored.public.state = 'applying'
    try {
      await this.audit?.record('apply_started', stored.public)
      await this.adapter.apply(stored.public, stored.payload)
      const verification = await this.adapter.verify(stored.public, stored.payload)
      stored.public.verification = verification
      if (!verification.ok) throw new Error(`Extension verification failed: ${verification.status}`)
      stored.public.state = 'committed'
      await this.audit?.record('committed', stored.public, verification.status)
      return { success: true, changeSet: { ...stored.public }, verification }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      stored.public.error = this.adapter.redactError?.(message) || message
      try {
        await this.adapter.rollback(stored.public, stored.payload)
        stored.public.state = 'rolled_back'
        await this.audit?.record('rolled_back', stored.public)
      } catch (rollbackError) {
        stored.public.state = 'failed'
        stored.public.error += `; rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
        await this.audit?.record('failed', stored.public)
      }
      return { success: false, changeSet: { ...stored.public }, error: stored.public.error }
    }
  }

  async verify(changeSetId: string): Promise<ExtensionOperationResult> {
    const stored = this.changes.get(changeSetId)
    if (!stored) return { success: false, error: 'Unknown extension change set' }
    this.expire(stored)
    if (stored.public.state !== 'committed') {
      return { success: false, changeSet: { ...stored.public }, error: `Change set is ${stored.public.state}` }
    }
    const verification = await this.adapter.verify(stored.public, stored.payload)
    stored.public.verification = verification
    await this.audit?.record('verified', stored.public, verification.status)
    return { success: verification.ok, changeSet: { ...stored.public }, verification, error: verification.ok ? undefined : verification.status }
  }

  private expire(stored: StoredChangeSet): void {
    if (stored.public.state === 'prepared' && stored.public.expiresAt <= this.now()) {
      stored.public.state = 'expired'
    }
  }

  private prune(): void {
    for (const stored of this.changes.values()) this.expire(stored)
    while (this.changes.size >= MAX_CHANGE_SETS) {
      const oldest = this.changes.keys().next().value
      if (typeof oldest !== 'string') break
      this.changes.delete(oldest)
    }
  }
}
