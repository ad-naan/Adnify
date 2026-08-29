import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import Store from 'electron-store'
import { createHash } from 'crypto'
import { logger } from '@shared/utils/Logger'

const BOOTSTRAP_STORE_NAME = 'bootstrap'

/**
 * config.json 里存着 provider 的 API key 和 OAuth 的 access/refresh token
 * （见 ProviderCredentialStore），必须只对当前用户可读。
 * conf（electron-store 的底层）默认 configFileMode 是 0o666 —— 同机器上的其他
 * 账户可以直接读。凭据原本在 openai-auth.json 里是 0600，迁进 config.json 时
 * 把这个约束丢了，这里补回来。
 */
const CONFIG_FILE_MODE = 0o600

/**
 * configFileMode 只在文件被创建时生效，所以老安装的 config.json 仍是 0666。
 * 对已存在的文件补一次 chmod，否则升级用户永远拿不到收紧后的权限。
 *
 * Windows 上 chmod 只能表达只读位、不映射 ACL，这里等于无操作；
 * 失败（文件还没落盘、只读介质、权限不足）也不该拦住启动。
 */
function restrictConfigFileMode(store: Store<Record<string, unknown>>): Store<Record<string, unknown>> {
  try {
    fs.chmodSync(store.path, CONFIG_FILE_MODE)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.store.warn('[ConfigPath] Failed to restrict config file mode:', error)
    }
  }
  return store
}

function createBootstrapStore(): Store<Record<string, unknown>> {
  return restrictConfigFileMode(new Store({ name: BOOTSTRAP_STORE_NAME, configFileMode: CONFIG_FILE_MODE }))
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
  return cwd
    ? { name, cwd, configFileMode: CONFIG_FILE_MODE }
    : { name, configFileMode: CONFIG_FILE_MODE }
}

export function createScopedStore(name: string, store: Store<Record<string, unknown>> = getBootstrapStore()) {
  return restrictConfigFileMode(new Store<Record<string, unknown>>(getStoreOptions(name, store)))
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

export function getWorkspaceCacheDir(workspaceRoot: string): string {
  const resolved = path.resolve(workspaceRoot).replace(/\\/g, '/')
  const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved
  const workspaceKey = createHash('sha256').update(normalized).digest('hex').slice(0, 24)
  return path.join(getUserConfigDir(), 'cache', 'workspaces', workspaceKey)
}

export const CONFIG_FILES = {
  MAIN: 'config.json',
  MCP: 'mcp.json',
  SETTINGS_DIR: 'settings',
} as const
