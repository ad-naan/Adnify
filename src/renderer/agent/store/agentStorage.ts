import { logger } from '@utils/Logger'
import { agentSessionRepository, type AgentSessionSnapshot } from '@services/agentSessionRepository'
import { toPersistedChatThread, type ChatThread } from '@renderer/agent/types'

let writeSuspendCount = 0
let scheduledPersistTimer: ReturnType<typeof setTimeout> | null = null
let pendingStateGetter: (() => Partial<PersistedAgentSessionState>) | null = null
const AGENT_STORAGE_VERSION = 0
// Session snapshots serialize every thread and can be large. Keep short UI bursts
// in memory so the repository can coalesce them into one durable write.
const DEFAULT_PERSIST_DEBOUNCE_MS = 750

export interface PersistedAgentSessionState {
  threads: Record<string, unknown>
  threadMessageVersions?: Record<string, number>
  currentThreadId: string | null
  branches: Record<string, unknown>
  activeBranchId: Record<string, unknown>
}

interface PersistedAgentStorageEnvelope {
  state: PersistedAgentSessionState
  version: number
}

const EMPTY_PERSISTED_AGENT_SESSION_STATE: PersistedAgentSessionState = {
  threads: {},
  threadMessageVersions: {},
  currentThreadId: null,
  branches: {},
  activeBranchId: {},
}

export function buildPersistedAgentSessionState(
  state: Partial<PersistedAgentSessionState>
): PersistedAgentSessionState {
  const rawThreads = state.threads || {}
  const threads = Object.fromEntries(
    Object.entries(rawThreads).map(([threadId, thread]) => [threadId, toPersistedChatThread(thread as ChatThread)])
  )

  return {
    threads,
    threadMessageVersions: state.threadMessageVersions || {},
    currentThreadId: state.currentThreadId || null,
    branches: state.branches || {},
    activeBranchId: state.activeBranchId || {},
  }
}

export function suspendAgentStorageWrites(): void {
  writeSuspendCount += 1
}

export function resumeAgentStorageWrites(): void {
  writeSuspendCount = Math.max(0, writeSuspendCount - 1)
}

export async function runWithAgentStorageWritesSuspended<T>(
  task: () => Promise<T> | T
): Promise<T> {
  suspendAgentStorageWrites()
  try {
    return await task()
  } finally {
    resumeAgentStorageWrites()
  }
}

export function areAgentStorageWritesSuspended(): boolean {
  return writeSuspendCount > 0
}

export function getSuspendedAgentPersistState(): PersistedAgentSessionState {
  return EMPTY_PERSISTED_AGENT_SESSION_STATE
}

export function buildAgentSessionSnapshot(
  state: Partial<PersistedAgentSessionState>,
  version = AGENT_STORAGE_VERSION
): AgentSessionSnapshot {
  const persistedState = buildPersistedAgentSessionState(state)

  return {
    threads: persistedState.threads as AgentSessionSnapshot['threads'],
    threadMessageVersions: persistedState.threadMessageVersions,
    currentThreadId: persistedState.currentThreadId,
    branches: persistedState.branches,
    activeBranchId: persistedState.activeBranchId,
    version,
  }
}

export function serializeAgentSessionSnapshot(snapshot: AgentSessionSnapshot): string {
  const envelope: PersistedAgentStorageEnvelope = {
    state: buildPersistedAgentSessionState(snapshot),
    version: snapshot.version,
  }

  return JSON.stringify(envelope)
}

export function parseAgentStorageValue(value: string): AgentSessionSnapshot {
  const parsed = JSON.parse(value) as PersistedAgentStorageEnvelope

  return buildAgentSessionSnapshot(parsed.state, parsed.version || AGENT_STORAGE_VERSION)
}

export function markAgentStorageSnapshotAsCurrent(snapshot: AgentSessionSnapshot | null): void {
  // Kept as a lifecycle boundary for callers. Snapshot equality used to be
  // tracked by JSON-stringifying every message in every thread here, which can
  // freeze the renderer after loading a large workspace. Dirty detection now
  // uses threadMessageVersions plus bounded metadata in the session repository.
  void snapshot
}

function clearScheduledPersistTimer(): void {
  if (scheduledPersistTimer !== null) {
    clearTimeout(scheduledPersistTimer)
    scheduledPersistTimer = null
  }
}

function stagePersistedAgentSessionFromGetter(
  getState: () => Partial<PersistedAgentSessionState>
): void {
  if (writeSuspendCount > 0) {
    return
  }
  const snapshot = buildAgentSessionSnapshot(getState())
  agentSessionRepository.stageSnapshot(snapshot)
}

export function schedulePersistedAgentSessionState(
  getState: () => Partial<PersistedAgentSessionState>,
  delayMs = DEFAULT_PERSIST_DEBOUNCE_MS
): void {
  if (writeSuspendCount > 0) {
    return
  }

  pendingStateGetter = getState
  clearScheduledPersistTimer()
  scheduledPersistTimer = setTimeout(() => {
    scheduledPersistTimer = null
    const stateGetter = pendingStateGetter
    pendingStateGetter = null
    if (!stateGetter) {
      return
    }

    stagePersistedAgentSessionFromGetter(stateGetter)
  }, delayMs)
}

export function flushScheduledPersistedAgentSessionState(
  getState?: () => Partial<PersistedAgentSessionState>
): void {
  clearScheduledPersistTimer()
  // During shutdown, prefer the explicitly provided getState (which reads the live store)
  // over the stale pendingStateGetter that was captured at debounce-schedule time.
  const stateGetter = getState || pendingStateGetter
  pendingStateGetter = null
  if (!stateGetter) {
    return
  }

  // Temporarily lift write suspension for shutdown flush.
  // During normal operation, writes may be suspended (e.g., during rehydration),
  // but at shutdown time we must persist regardless.
  const wasSuspended = writeSuspendCount
  writeSuspendCount = 0
  try {
    stagePersistedAgentSessionFromGetter(stateGetter)
  } finally {
    writeSuspendCount = wasSuspended
  }
}

export function stageAgentSessionState(
  state: Partial<PersistedAgentSessionState>
): void {
  stagePersistedAgentSessionFromGetter(() => state)
}

export async function persistCriticalAgentSessionState(
  state: PersistedAgentSessionState
): Promise<void> {
  try {
    flushScheduledPersistedAgentSessionState()
    agentSessionRepository.stageSnapshot(buildAgentSessionSnapshot(state))
    await agentSessionRepository.flush()
  } catch (error) {
    logger.agent.error('[AgentStorage] Failed to persist critical agent session state:', error)
  }
}

export async function clearPersistedAgentSessionState(): Promise<void> {
  clearScheduledPersistTimer()
  pendingStateGetter = null
  await agentSessionRepository.clear()
}
