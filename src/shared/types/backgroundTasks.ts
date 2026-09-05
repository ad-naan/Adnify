export interface BackgroundTaskSettings {
  taskbarProgress: boolean
  preventIdleSleep: boolean
  checkConnectionsOnResume: boolean
}

export const DEFAULT_BACKGROUND_TASK_SETTINGS: BackgroundTaskSettings = {
  taskbarProgress: true,
  preventIdleSleep: false,
  checkConnectionsOnResume: true,
}

export function normalizeBackgroundTaskSettings(value: unknown): BackgroundTaskSettings {
  const input = (value && typeof value === 'object' ? value : {}) as Partial<BackgroundTaskSettings>
  return {
    taskbarProgress: typeof input.taskbarProgress === 'boolean' ? input.taskbarProgress : true,
    preventIdleSleep: typeof input.preventIdleSleep === 'boolean' ? input.preventIdleSleep : false,
    checkConnectionsOnResume: typeof input.checkConnectionsOnResume === 'boolean' ? input.checkConnectionsOnResume : true,
  }
}

/** No credentials or prompts cross this bridge. */
export interface BackgroundTaskActivity {
  state: 'idle' | 'running' | 'paused' | 'error'
  progress?: number
  model?: { provider: string; baseUrl?: string }
}

export interface McpConnectionCheck {
  checked: number
  failed: Array<{ id: string; name: string }>
}

export interface ConnectionReport {
  checkedAt: number
  model: 'reachable' | 'unreachable' | 'unconfigured'
  mcp: McpConnectionCheck
  checkFailed: boolean
}

export interface BackgroundConnectionState {
  checking: boolean
  report: ConnectionReport | null
}
