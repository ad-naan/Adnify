import { logger } from '@utils/Logger'
import { adnifyDir, type AgentSessionSnapshot } from '@services/adnifyDirService'
import { toPersistedChatThread, type ChatThread } from '@renderer/agent/types'

let lastSerializedValue: string | null = null
let writeSuspendCount = 0
let scheduledPersistTimer: ReturnType<typeof setTimeout> | null = null
let pendingStateGetter: (() => Partial<PersistedAgentSessionState>) | null = null
const AGENT_STORAGE_VERSION = 0
const DEFAULT_PERSIST_DEBOUNCE_MS = 240

export interface PersistedAgentSessionState {
  threads: Record<string, unknown>
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
  lastSerializedValue = snapshot ? serializeAgentSessionSnapshot(snapshot) : null
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
  if (!adnifyDir.isInitialized()) {
    return
  }

  const snapshot = buildAgentSessionSnapshot(getState())
  const serialized = serializeAgentSessionSnapshot(snapshot)
  if (serialized === lastSerializedValue) {
    return
  }

  adnifyDir.stageAgentSessionSnapshot(snapshot)
  lastSerializedValue = serialized
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
  const stateGetter = getState || pendingStateGetter
  pendingStateGetter = null
  if (!stateGetter) {
    return
  }

  stagePersistedAgentSessionFromGetter(stateGetter)
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
    adnifyDir.stageAgentSessionSnapshot(buildAgentSessionSnapshot(state))
    await adnifyDir.flush()
    lastSerializedValue = null
  } catch (error) {
    logger.agent.error('[AgentStorage] Failed to persist critical agent session state:', error)
  }
}

export async function clearPersistedAgentSessionState(): Promise<void> {
  clearScheduledPersistTimer()
  pendingStateGetter = null
  lastSerializedValue = null
  await adnifyDir.clearAllSessions()
}
