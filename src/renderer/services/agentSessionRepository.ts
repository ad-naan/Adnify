import {
  fromPersistedChatThread,
  toPersistedChatThread,
  type ChatMessage,
  type ChatThread,
  type PersistedChatThread,
} from '@/renderer/agent/types'
import type {
  SessionCatalogRecord,
  SessionBranchPatch,
  SessionBranchThreadPatch,
  SessionMessageWrite,
  SessionPatch,
  SessionStateRecord,
  SessionThreadMetadata,
  SessionThreadPatch,
} from '@shared/types/sessionPersistence'
import { api } from './electronAPI'
import type { AgentSessionSnapshot } from './persistence/types'
import { logger } from '@utils/Logger'
import { BufferedCommitQueue } from '@shared/persistence/BufferedCommitQueue'
import { persistenceCoordinator } from './persistence/PersistenceCoordinator'
import type { Branch } from '@renderer/agent/store/slices'

const AUTO_FLUSH_DELAY_MS = 100

interface ThreadBaseline {
  metadata: ThreadMetadataSignature
  messages: ChatMessage[] | null
  messageVersion: number
}

interface StateBaseline {
  currentThreadId: string | null
  activeBranchId: Record<string, unknown>
  version: number
}

interface BranchBaseline {
  branches: Branch[]
  hydrated: boolean
}

function toThreadMetadata(thread: ChatThread): SessionThreadMetadata {
  const persisted = toPersistedChatThread(thread)
  const { id, createdAt, lastModified, title, messages: _messages, messageCount: _count, ...data } = persisted
  return {
    id,
    createdAt,
    lastModified,
    title,
    messageCount: thread.messagesHydrated === false
      ? (thread.messageCount || 0)
      : persisted.messages.length,
    data,
  }
}

/**
 * Reference-based dirty signature for a thread's metadata.
 *
 * `metadata.data` transitively holds `messageCheckpoints`, whose `fileSnapshots`
 * store whole file contents (plus base64 images). JSON-stringifying it to compare
 * against a baseline meant every persist re-serialized every checkpoint of every
 * thread — tens of MB of throwaway strings, synchronously on the renderer's main
 * thread, growing with each task the agent runs.
 *
 * All writers replace `data` and its nested containers instead of mutating them
 * (see `updateThreadCheckpoints` / `addSnapshotToCheckpoint`), so identity
 * comparison detects every real change without reading the payload. Scalars are
 * compared by value because `toThreadMetadata` rebuilds the wrapper each call.
 */
interface ThreadMetadataSignature {
  createdAt: number
  lastModified: number
  title: string | undefined
  messageCount: number
  data: Record<string, unknown>
}

function metadataSignature(metadata: SessionThreadMetadata): ThreadMetadataSignature {
  return {
    createdAt: metadata.createdAt,
    lastModified: metadata.lastModified,
    title: metadata.title,
    messageCount: metadata.messageCount,
    data: metadata.data,
  }
}

function metadataSignatureEquals(
  a: ThreadMetadataSignature,
  b: ThreadMetadataSignature,
): boolean {
  if (
    a.createdAt !== b.createdAt ||
    a.lastModified !== b.lastModified ||
    a.title !== b.title ||
    a.messageCount !== b.messageCount
  ) {
    return false
  }

  // `data` is rebuilt by object rest in toThreadMetadata, so the wrapper is
  // always a fresh object — compare its fields by identity instead. Undefined
  // entries are skipped on both sides: toPersistedChatThread sets every optional
  // field explicitly, while a JSON round-trip through SQLite drops them, so the
  // key sets legitimately differ for a thread that has not actually changed.
  for (const key of new Set([...Object.keys(a.data), ...Object.keys(b.data)])) {
    if (a.data[key] !== b.data[key]) return false
  }

  return true
}

function toMessageWrite(message: ChatMessage, ordinal: number): SessionMessageWrite {
  return {
    ordinal,
    id: message.id,
    role: message.role,
    timestamp: message.timestamp,
    payload: message,
  }
}

function fromCatalog(catalog: SessionCatalogRecord): AgentSessionSnapshot {
  const threads: Record<string, ChatThread> = {}
  const branches: Record<string, Branch[]> = {}
  for (const metadata of catalog.threads) {
    const persisted = {
      ...metadata.data,
      id: metadata.id,
      createdAt: metadata.createdAt,
      lastModified: metadata.lastModified,
      title: metadata.title,
      messages: [],
      messageCount: metadata.messageCount,
    } as unknown as PersistedChatThread
    threads[metadata.id] = fromPersistedChatThread(persisted)
  }
  for (const metadata of catalog.branches) {
    const branch = {
      ...metadata.data,
      id: metadata.id,
      name: metadata.name,
      forkFromMessageId: metadata.forkFromMessageId,
      createdAt: metadata.createdAt,
      isActive: metadata.isActive,
      messages: [],
    } as Branch
    ;(branches[metadata.threadId] ||= []).push(branch)
  }

  return {
    threads,
    currentThreadId: catalog.state.currentThreadId,
    branches,
    activeBranchId: catalog.state.activeBranchId,
    version: catalog.state.version,
  }
}

function stateChanged(snapshot: AgentSessionSnapshot, baseline: StateBaseline | null): boolean {
  return !baseline ||
    snapshot.currentThreadId !== baseline.currentThreadId ||
    snapshot.activeBranchId !== baseline.activeBranchId ||
    snapshot.version !== baseline.version
}

function findChangedMessageIndex(previous: ChatMessage[], current: ChatMessage[]): number | null {
  const sharedLength = Math.min(previous.length, current.length)
  for (let index = 0; index < sharedLength; index += 1) {
    if (previous[index] !== current[index] || previous[index].id !== current[index].id) return index
  }
  return previous.length === current.length ? null : sharedLength
}

export class AgentSessionRepository {
  private readonly baselines = new Map<string, ThreadBaseline>()
  private readonly branchBaselines = new Map<string, BranchBaseline>()
  private readonly hydratedBranchThreads = new Set<string>()
  private persistedThreadIds = new Set<string>()
  private stateBaseline: StateBaseline | null = null
  private latestSnapshot: AgentSessionSnapshot | null = null
  private readonly explicitDeletions = new Set<string>()
  private readonly commits = new BufferedCommitQueue<AgentSessionSnapshot>({
    delayMs: AUTO_FLUSH_DELAY_MS,
    commit: snapshot => this.commitSnapshot(snapshot),
    onBackgroundError: error => {
      logger.agent.error('[SessionStorage] SQLite commit failed:', error)
    },
  })

  async getSnapshot(): Promise<AgentSessionSnapshot | null> {
    this.commits.discard()
    const opened = await api.session.open()
    const snapshot = fromCatalog(opened.catalog)
    this.latestSnapshot = snapshot
    this.explicitDeletions.clear()

    this.baselines.clear()
    this.branchBaselines.clear()
    this.hydratedBranchThreads.clear()
    this.persistedThreadIds = new Set(Object.keys(snapshot.threads))
    for (const metadata of opened.catalog.threads) {
      this.baselines.set(metadata.id, {
        metadata: metadataSignature(metadata),
        messages: metadata.messageCount === 0 ? [] : null,
        messageVersion: 0,
      })
    }
    for (const [threadId, branches] of Object.entries(snapshot.branches as Record<string, Branch[]>)) {
      const metadata = opened.catalog.branches.filter(branch => branch.threadId === threadId)
      this.branchBaselines.set(threadId, {
        branches,
        hydrated: metadata.every(branch => branch.messageCount === 0),
      })
      if (metadata.every(branch => branch.messageCount === 0)) this.hydratedBranchThreads.add(threadId)
    }
    for (const threadId of Object.keys(snapshot.threads)) {
      if (!snapshot.branches[threadId]) this.hydratedBranchThreads.add(threadId)
    }
    this.stateBaseline = {
      currentThreadId: snapshot.currentThreadId,
      activeBranchId: snapshot.activeBranchId,
      version: snapshot.version,
    }
    return snapshot
  }

  stageSnapshot(snapshot: AgentSessionSnapshot): void {
    this.latestSnapshot = snapshot
    this.commits.stage(snapshot)
  }

  async loadThreadMessages(threadId: string): Promise<ChatMessage[]> {
    const messages = await api.session.loadMessages(threadId) as ChatMessage[]
    const baseline = this.baselines.get(threadId)
    if (baseline) {
      baseline.messages = messages
      baseline.messageVersion = messages.length
    }
    return messages
  }

  async loadThreadBranches(threadId: string): Promise<Branch[]> {
    const loaded = await api.session.loadBranchMessages(threadId)
    const byId = new Map(loaded.map(branch => [branch.id, branch.messages as ChatMessage[]]))
    const metadata = (this.latestSnapshot?.branches[threadId] || []) as Branch[]
    const branches = metadata.map(branch => ({
      ...branch,
      messages: byId.get(branch.id) || [],
    }))
    this.branchBaselines.set(threadId, { branches, hydrated: true })
    this.hydratedBranchThreads.add(threadId)
    if (this.latestSnapshot) {
      this.latestSnapshot = {
        ...this.latestSnapshot,
        branches: { ...this.latestSnapshot.branches, [threadId]: branches },
      }
    }
    return branches
  }

  areThreadBranchesHydrated(threadId: string): boolean {
    return this.hydratedBranchThreads.has(threadId)
  }

  /**
   * Drop the repository's own copy of a thread's messages.
   *
   * `commitBaselines` keeps the last committed message array per thread so the
   * next patch can send only the changed tail. That is a second reference to
   * every hydrated thread's history, so unloading a thread from the store frees
   * nothing unless this is released too.
   *
   * Refuses while a commit is pending: that staged snapshot still holds the full
   * messages, and committing it would re-populate the baseline. More importantly,
   * a caller that unloaded anyway would mark the thread un-hydrated, making the
   * pending patch skip its messages — losing writes that never reached disk.
   * Returns whether the caller may proceed with unloading.
   */
  releaseThreadMessages(threadId: string): boolean {
    if (this.commits.hasPending()) return false

    const baseline = this.baselines.get(threadId)
    // No baseline means nothing was ever committed for this thread; unloading
    // would leave the next patch unable to tell what is already on disk.
    if (!baseline) return false

    // Forces a full message rewrite if this thread is edited after rehydration,
    // which is correct — just less incremental than the tail-diff path.
    baseline.messages = null
    return true
  }

  async deleteThread(threadId: string): Promise<void> {
    if (!this.latestSnapshot) {
      await api.session.applyPatch({ threads: [], deletedThreadIds: [threadId], branchThreads: [] })
      return
    }

    this.explicitDeletions.add(threadId)
    const { [threadId]: _thread, ...threads } = this.latestSnapshot.threads
    const { [threadId]: _messageVersion, ...threadMessageVersions } =
      this.latestSnapshot.threadMessageVersions || {}
    const { [threadId]: _branches, ...branches } = this.latestSnapshot.branches
    const { [threadId]: _activeBranch, ...activeBranchId } = this.latestSnapshot.activeBranchId
    this.stageSnapshot({
      ...this.latestSnapshot,
      threads,
      threadMessageVersions,
      branches,
      activeBranchId,
      currentThreadId: this.latestSnapshot.currentThreadId === threadId
        ? null
        : this.latestSnapshot.currentThreadId,
    })
    await this.flush()
  }

  async clear(): Promise<void> {
    // Preserve ordering with any commit already in flight; clear must be the
    // final database operation, otherwise an older snapshot could resurrect.
    await this.commits.flush()
    this.commits.discard()
    await api.session.clear()
    this.baselines.clear()
    this.branchBaselines.clear()
    this.hydratedBranchThreads.clear()
    this.persistedThreadIds.clear()
    this.stateBaseline = null
    this.latestSnapshot = null
    this.explicitDeletions.clear()
  }

  flush(): Promise<void> {
    return this.commits.flush()
  }

  private async commitSnapshot(snapshot: AgentSessionSnapshot): Promise<void> {
    const patch = this.buildPatch(snapshot)
    if (patch.state || patch.threads.length > 0 || patch.deletedThreadIds.length > 0 ||
      patch.branchThreads.length > 0) {
      await api.session.applyPatch(patch)
    }
    this.commitBaselines(snapshot, patch)
  }

  private buildPatch(snapshot: AgentSessionSnapshot): SessionPatch {
    const threads: SessionThreadPatch[] = []
    const branchThreads: SessionBranchThreadPatch[] = []
    const currentIds = new Set(Object.keys(snapshot.threads))
    const deletedThreadIds = [...new Set([
      ...[...this.persistedThreadIds].filter(id => !currentIds.has(id)),
      ...this.explicitDeletions,
    ])]

    for (const [threadId, thread] of Object.entries(snapshot.threads)) {
      const metadata = toThreadMetadata(thread)
      const baseline = this.baselines.get(threadId)
      const messageVersion = snapshot.threadMessageVersions?.[threadId] || 0
      const metadataChanged =
        !baseline || !metadataSignatureEquals(baseline.metadata, metadataSignature(metadata))
      let replaceFrom: number | undefined

      if (thread.messagesHydrated !== false && (!baseline || baseline.messageVersion !== messageVersion)) {
        if (!baseline?.messages) {
          replaceFrom = 0
        } else {
          const changedIndex = findChangedMessageIndex(baseline.messages, thread.messages)
          // A bumped version with identical references means the streaming path
          // mutated the final message in place. Replace only that final row.
          replaceFrom = changedIndex ?? Math.max(0, thread.messages.length - 1)
        }
      }

      if (metadataChanged || replaceFrom !== undefined) {
        threads.push({
          metadata,
          ...(replaceFrom === undefined ? {} : {
            replaceFrom,
            messages: thread.messages
              .slice(replaceFrom)
              .map((message, index) => toMessageWrite(message, replaceFrom + index)),
          }),
        })
      }
    }

    const branchThreadIds = new Set([
      ...this.branchBaselines.keys(),
      ...Object.keys(snapshot.branches),
    ])
    for (const threadId of branchThreadIds) {
      if (deletedThreadIds.includes(threadId)) continue
      const current = (snapshot.branches[threadId] || []) as Branch[]
      const baseline = this.branchBaselines.get(threadId)
      if (baseline?.branches === current) continue
      if (baseline && !baseline.hydrated) {
        throw new Error(`Cannot persist unhydrated branches for thread ${threadId}`)
      }
      branchThreads.push({
        threadId,
        branches: current.map((branch, ordinal): SessionBranchPatch => {
          const { id, name, forkFromMessageId, createdAt, isActive, messages, ...data } = branch
          return {
            threadId,
            id,
            ordinal,
            name,
            forkFromMessageId,
            createdAt,
            isActive,
            messageCount: messages.length,
            data,
            messages: messages.map(toMessageWrite),
          }
        }),
      })
    }

    const state: SessionStateRecord | undefined = stateChanged(snapshot, this.stateBaseline)
      ? {
          currentThreadId: snapshot.currentThreadId,
          activeBranchId: snapshot.activeBranchId,
          version: snapshot.version,
        }
      : undefined

    return { state, threads, deletedThreadIds, branchThreads }
  }

  private commitBaselines(snapshot: AgentSessionSnapshot, patch: SessionPatch): void {
    for (const threadId of patch.deletedThreadIds) this.baselines.delete(threadId)
    for (const threadId of patch.deletedThreadIds) this.branchBaselines.delete(threadId)
    for (const threadId of patch.deletedThreadIds) this.hydratedBranchThreads.delete(threadId)
    for (const threadId of patch.deletedThreadIds) this.explicitDeletions.delete(threadId)
    this.persistedThreadIds = new Set(Object.keys(snapshot.threads))

    for (const threadPatch of patch.threads) {
      const thread = snapshot.threads[threadPatch.metadata.id]
      if (!thread) continue
      const previous = this.baselines.get(thread.id)
      this.baselines.set(thread.id, {
        metadata: metadataSignature(threadPatch.metadata),
        messages: thread.messagesHydrated === false ? (previous?.messages || null) : thread.messages,
        messageVersion: snapshot.threadMessageVersions?.[thread.id] || 0,
      })
    }
    for (const branchPatch of patch.branchThreads) {
      this.branchBaselines.set(branchPatch.threadId, {
        branches: (snapshot.branches[branchPatch.threadId] || []) as Branch[],
        hydrated: true,
      })
    }
    if (patch.state) {
      this.stateBaseline = {
        currentThreadId: snapshot.currentThreadId,
        activeBranchId: snapshot.activeBranchId,
        version: snapshot.version,
      }
    }
  }
}

export const agentSessionRepository = new AgentSessionRepository()
persistenceCoordinator.register({
  id: 'agent-sessions',
  scope: 'workspace',
  flush: () => agentSessionRepository.flush(),
})
export type { AgentSessionSnapshot }
