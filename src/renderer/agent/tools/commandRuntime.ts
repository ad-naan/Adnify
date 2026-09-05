import { platform as runtimePlatform } from '@shared/utils/pathUtils'

export const LONG_RUNNING_COMMAND_PATTERN = /^(?:(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?(?:dev|start|serve|watch)(?:\s|$)|python\s+-m\s+(?:http\.server|flask)(?:\s|$)|(?:uvicorn|nodemon)(?:\s|$)|vite(?:\s+(?:--\S+|serve|dev))?\s*$|webpack\s+.*--watch(?:\s|$))/

export type InteractiveTerminalBackend = 'pty' | 'pipe'

const currentPlatform: NodeJS.Platform = runtimePlatform.isWindows ? 'win32' : runtimePlatform.isMac ? 'darwin' : 'linux'

export function isLongRunningCommand(command: string, isBackground?: boolean): boolean {
  return isBackground ?? LONG_RUNNING_COMMAND_PATTERN.test(command.trim())
}

export function getInteractiveTerminalBackend(
  platform: NodeJS.Platform = currentPlatform,
): InteractiveTerminalBackend {
  return platform === 'darwin' ? 'pipe' : 'pty'
}
