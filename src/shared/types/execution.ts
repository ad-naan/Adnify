export const EXECUTION_LIMITS = {
  commands: 8, commandsPerWindow: 4, commandsPerThread: 1,
  background: 16, backgroundPerWindow: 4, persistent: 64,
  queued: 128, queuedPerWindow: 32, queuedPerThread: 8,
  queueTimeoutMs: 30_000, outputBytes: 256 * 1024, history: 64,
} as const

export type ExecutionStatus = 'queued' | 'starting' | 'running' | 'stopping'
  | 'completed' | 'failed' | 'cancelled' | 'expired' | 'unknown'
export type ExecutionMode = 'command' | 'background'
export interface ExecutionRequest {
  requestKey: string
  threadId: string
  command: string
  cwd?: string
  shell?: string
  mode: ExecutionMode
  timeoutMs?: number
  authorizationId?: string
  serviceKey?: string
}
export interface ExecutionSnapshot {
  jobId: string
  requestKey: string
  threadId: string
  command: string
  cwd: string
  shell: string
  mode: ExecutionMode
  status: ExecutionStatus
  submittedAt: number
  startedAt?: number
  endedAt?: number
  exitCode: number | null
  signal?: string
  reason?: string
  output: string
  truncated: boolean
  revision: number
  consumers?: number
  ownerId?: number
  workspaceId?: string
  hosted?: boolean
  waitingReason?: string
  archived?: boolean
  pinned?: boolean
  logTruncated?: boolean
  logError?: string
}
export const isExecutionFinished = (status: ExecutionStatus): boolean =>
  ['completed', 'failed', 'cancelled', 'expired'].includes(status)

export type ExecutionReply = { success: true; job: ExecutionSnapshot }
  | { success: false; error: string; code?: string }
export interface ExecutionUsage {
  commands: number
  background: number
  sessions: number
  queued: number
}

export interface InteractiveSessionSnapshot {
  id: string
  cwd: string
  shell: string
  isAgent: boolean
  remoteHost?: string
  state: 'starting' | 'ready' | 'busy' | 'unknown' | 'stopping' | 'exited'
  userControlled: boolean
  output: string
  revision: number
  exitCode?: number
  disposable?: boolean
  lastUsedAt?: number
}

export interface ExecutionOverview {
  success: boolean
  ownerId?: number
  error?: string
  settings: import('../config/executionSettings').ExecutionSettings
  usage: ExecutionUsage
  jobs: ExecutionSnapshot[]
  archives: ExecutionSnapshot[]
  sessions: (InteractiveSessionSnapshot & { ownerId: number })[]
}
export type ExecutionManagementAction = 'stop' | 'stop-session' | 'host' | 'unhost' | 'pin' | 'unpin' | 'delete' | 'export' | 'log' | 'recycle' | 'retain'
