import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import Store from 'electron-store'

const BOOTSTRAP_STORE_NAME = 'bootstrap'

function createBootstrapStore(): Store<Record<string, unknown>> {
  return new Store({ name: BOOTSTRAP_STORE_NAME })
}

function resolveExistingDirectory(targetPath: string | undefined): string | undefined {
  if (!targetPath) {
    return undefined
  }

  return fs.existsSync(targetPath) ? targetPath : undefined
}

export function getBootstrapStore(): Store<Record<string, unknown>> {
  return createBootstrapStore()
}

export function getCustomConfigPath(store: Store<Record<string, unknown>> = getBootstrapStore()): string | undefined {
  return resolveExistingDirectory(store.get('customConfigPath') as string | undefined)
}

export function getStoreOptions(name: string, store: Store<Record<string, unknown>> = getBootstrapStore()) {
  const cwd = getCustomConfigPath(store)
  return cwd ? { name, cwd } : { name }
}

export function createScopedStore(name: string, store: Store<Record<string, unknown>> = getBootstrapStore()) {
  return new Store<Record<string, unknown>>(getStoreOptions(name, store))
}

export function getUserConfigDir(store: Store<Record<string, unknown>> = getBootstrapStore()): string {
  return getCustomConfigPath(store) ?? app.getPath('userData')
}

export function setUserConfigDir(newPath: string, store: Store<Record<string, unknown>> = getBootstrapStore()): void {
  store.set('customConfigPath', newPath)
}

export function getConfigFilePath(filename: string, subdir?: string, store?: Store<Record<string, unknown>>): string {
  const baseDir = getUserConfigDir(store)
  return subdir ? path.join(baseDir, subdir, filename) : path.join(baseDir, filename)
}

export function getWorkspaceConfigFilePath(
  workspaceRoot: string,
  filename: string,
  subdir?: string
): string {
  return subdir
    ? path.join(workspaceRoot, '.adnify', subdir, filename)
    : path.join(workspaceRoot, '.adnify', filename)
}

export const CONFIG_FILES = {
  MAIN: 'config.json',
  MCP: 'mcp.json',
  SETTINGS_DIR: 'settings',
} as const
