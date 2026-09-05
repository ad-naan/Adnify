import { EXECUTION_LIMITS } from '../types/execution'

export const EXECUTION_SETTINGS_DEFAULTS = {
  ...EXECUTION_LIMITS,
  memoryBytes: 16 * 1024 * 1024,
  logBytes: 10 * 1024 * 1024,
  diskBytes: 256 * 1024 * 1024,
  idleTimeoutMs: 120_000,
  idlePerWindow: 1,
  idleGlobal: 4,
}
export type ExecutionSettings = typeof EXECUTION_SETTINGS_DEFAULTS extends infer T ? { [K in keyof T]: number } : never
export const EXECUTION_SETTING_RANGES: Record<keyof ExecutionSettings, readonly [number, number]> = {
  commands: [1, 64], commandsPerWindow: [1, 32], commandsPerThread: [1, 8],
  background: [1, 64], backgroundPerWindow: [1, 32], persistent: [1, 256],
  queued: [1, 1024], queuedPerWindow: [1, 256], queuedPerThread: [1, 64],
  queueTimeoutMs: [1000, 300_000], outputBytes: [16_384, 1024 * 1024], history: [1, 512],
  memoryBytes: [1024 * 1024, 64 * 1024 * 1024], logBytes: [64 * 1024, 64 * 1024 * 1024],
  diskBytes: [8 * 1024 * 1024, 1024 * 1024 * 1024], idleTimeoutMs: [10_000, 3600_000],
  idlePerWindow: [0, 16], idleGlobal: [0, 64],
}
export function normalizeExecutionSettings(value: unknown): ExecutionSettings {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const result = { ...EXECUTION_SETTINGS_DEFAULTS } as ExecutionSettings
  for (const key of Object.keys(result) as (keyof ExecutionSettings)[]) {
    const n = input[key]
    const [min, max] = EXECUTION_SETTING_RANGES[key]
    if (typeof n === 'number' && Number.isFinite(n)) result[key] = Math.min(max, Math.max(min, Math.floor(n)))
  }
  result.commandsPerWindow = Math.min(result.commandsPerWindow, result.commands)
  result.commandsPerThread = Math.min(result.commandsPerThread, result.commandsPerWindow)
  result.backgroundPerWindow = Math.min(result.backgroundPerWindow, result.background)
  result.queuedPerWindow = Math.min(result.queuedPerWindow, result.queued)
  result.queuedPerThread = Math.min(result.queuedPerThread, result.queuedPerWindow)
  result.outputBytes = Math.min(result.outputBytes, result.memoryBytes)
  result.logBytes = Math.min(result.logBytes, result.diskBytes)
  result.idlePerWindow = Math.min(result.idlePerWindow, result.idleGlobal)
  return result
}
