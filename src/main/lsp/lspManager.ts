/**
 * 内置 LSP 管理器
 * 支持多根目录工作区（为每个根目录启动独立的服务器实例）
 * 
 * 增强功能：
 * - 智能根目录检测
 * - Call Hierarchy 支持
 * - waitForDiagnostics 机制
 * - 更多语言服务器支持
 * - 自动下载安装 LSP 服务器
 */

import { logger } from '@shared/utils/Logger'
import { toAppError } from '@shared/utils/errorHandler'
import { getExecutableName } from '@shared/utils/pathUtils'
import { normalizeLspUri, pathToLspUri } from '@shared/utils/uriUtils'
import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { createHash } from 'crypto'
import { BrowserWindow } from 'electron'
import { LanguageId, LSP_SERVER_DEFINITIONS, LspServerId } from '@shared/languages'
import { LSP_DEFAULTS } from '@shared/config/defaults'
import { CacheService } from '@shared/utils/CacheService'
import { getCacheConfig } from '@shared/config/agentConfig'
import {
  getInstalledServerPath,
  getLspBinDir,
  commandExists,
} from './installer'
import {
  JSON_RPC_METHOD_NOT_FOUND,
  JsonRpcMessage,
  createJsonRpcError,
  createJsonRpcResult,
  encodeLspMessage,
  isClientResponse,
  isCoalescibleReadMethod,
  isServerNotification,
  isServerRequest,
  shouldRetryContentModified,
} from './protocol'
import { DocumentOwnership, ReleasedDocument } from './documentOwnership'

// 重新导出 LanguageId 供其他模块使用
export type { LanguageId } from '@shared/languages'

// ============ 类型定义 ============

interface LspServerConfig {
  name: LspServerId
  getCommand: (workspacePath: string) => Promise<{ command: string; args: string[] } | null>
  /** 智能根目录检测函数，返回 null 表示不应该使用此服务器 */
  findRoot?: (filePath: string, workspacePath: string) => Promise<string | null>
  /** 自动安装函数 */
  install?: () => Promise<{ success: boolean; path?: string; error?: string }>
}

interface LspServerInstance {
  config: LspServerConfig
  process: ChildProcess | null
  requestId: number
  pendingRequests: Map<number, PendingRequest>
  buffer: Buffer
  contentLength: number
  initialized: boolean
  workspacePath: string
}

interface PendingRequest {
  resolve: (value: any) => void
  reject: (reason?: unknown) => void
  timeout: NodeJS.Timeout
}

interface CrashState {
  count: number
  lastCrashTime: number
  restartTimer?: NodeJS.Timeout
}

interface ResolvedServerRoute {
  serverName: LspServerId
  workspacePath: string
}

export type DocumentSyncResult =
  | { action: 'open' | 'change'; version: number }
  | { action: 'none'; version: number }

// ============ 智能根目录检测辅助函数 ============

/**
 * 向上查找包含指定文件的目录
 */
async function findNearestRoot(
  startDir: string,
  stopDir: string,
  patterns: string[],
  excludePatterns?: string[]
): Promise<string | undefined> {
  let currentDir = startDir

  // 该函数在打开文件的交互路径上被调用，且每层目录都要做多次 fs 调用。
  // 使用异步 fs，避免深层目录下同步 IO 阻塞主线程。
  const exists = async (p: string): Promise<boolean> => {
    try {
      await fs.promises.access(p)
      return true
    } catch {
      return false
    }
  }

  while (currentDir.length >= stopDir.length) {
    // 检查排除模式
    if (excludePatterns) {
      for (const pattern of excludePatterns) {
        const excludePath = path.join(currentDir, pattern)
        if (await exists(excludePath)) {
          return undefined // 被排除
        }
      }
    }

    // 检查目标模式（支持 glob-like *.ext 匹配）
    for (const pattern of patterns) {
      if (pattern.includes('*')) {
        try {
          const entries = await fs.promises.readdir(currentDir)
          const re = new RegExp('^' + pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$')
          if (entries.some(entry => re.test(entry))) {
            return currentDir
          }
        } catch {
          // directory not readable, skip
        }
      } else {
        const targetPath = path.join(currentDir, pattern)
        if (await exists(targetPath)) {
          return currentDir
        }
      }
    }

    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) break
    currentDir = parentDir
  }

  return undefined
}

// ============ 服务器命令获取函数 ============
// 使用 installer.ts 中的 getInstalledServerPath 统一查找路径

async function getTypeScriptServerCommand(): Promise<{ command: string; args: string[] } | null> {
  const serverPath = getInstalledServerPath('typescript')
  if (serverPath) {
    logger.lsp.debug('[LSP Manager] TypeScript server path:', serverPath)
    return { command: process.execPath, args: [serverPath, '--stdio'] }
  }
  return null
}

async function getHtmlServerCommand(): Promise<{ command: string; args: string[] } | null> {
  const serverPath = getInstalledServerPath('html')
  if (serverPath) return { command: process.execPath, args: [serverPath, '--stdio'] }
  return null
}

async function getCssServerCommand(): Promise<{ command: string; args: string[] } | null> {
  const serverPath = getInstalledServerPath('css')
  if (serverPath) return { command: process.execPath, args: [serverPath, '--stdio'] }
  return null
}

async function getJsonServerCommand(): Promise<{ command: string; args: string[] } | null> {
  const serverPath = getInstalledServerPath('json')
  if (serverPath) return { command: process.execPath, args: [serverPath, '--stdio'] }
  return null
}

// ============ Python 环境检测 ============

import { getLanguageEnv, resolveRuntimePath } from './languageEnvConfig'

/** 缓存已检测的 Python 路径（按工作区） */
const pythonPathCache = new Map<string, string>()

function getPythonAnalysisSettings(workspacePath: string) {
  const languageEnv = getLanguageEnv(workspacePath, 'python')
  return {
    typeCheckingMode: 'basic',
    diagnosticMode: 'openFilesOnly',
    autoSearchPaths: true,
    useLibraryCodeForTypes: true,
    extraPaths: languageEnv?.extraPaths || [],
    diagnosticSeverityOverrides: {},
  }
}

function getTypeScriptInitializationOptions(workspacePath: string) {
  const workspaceTsserver = path.join(workspacePath, 'node_modules', 'typescript', 'lib', 'tsserver.js')
  if (fs.existsSync(workspaceTsserver)) {
    return { tsserver: { path: workspaceTsserver } }
  }

  const serverPath = getInstalledServerPath('typescript')
  const managedTsserver = serverPath
    ? path.resolve(path.dirname(serverPath), '..', '..', 'typescript', 'lib', 'tsserver.js')
    : null
  return managedTsserver && fs.existsSync(managedTsserver)
    ? { tsserver: { fallbackPath: managedTsserver } }
    : undefined
}

function getPythonPathForWorkspace(workspacePath: string): string {
  const cached = pythonPathCache.get(workspacePath)
  if (cached) return cached

  const resolved = resolveRuntimePath(workspacePath, 'python')
  pythonPathCache.set(workspacePath, resolved)
  logger.lsp.info(`[LSP] Python path for ${workspacePath}: ${resolved}`)
  return resolved
}

/** 清除缓存（配置变更后调用） */
export function invalidatePythonPathCache(workspacePath?: string): void {
  if (workspacePath) {
    pythonPathCache.delete(workspacePath)
  } else {
    pythonPathCache.clear()
  }
}

// Python LSP (pyright)
async function getPythonServerCommand(): Promise<{ command: string; args: string[] } | null> {
  // 优先使用 pyright（通过 npm 安装）
  const serverPath = getInstalledServerPath('python')

  if (serverPath) {
    return { command: process.execPath, args: [serverPath, '--stdio'] }
  }

  // 检查系统是否有 pylsp
  if (commandExists('pylsp')) {
    return { command: 'pylsp', args: [] }
  }

  return null
}

// Go LSP (gopls)
async function getGoplsCommand(): Promise<{ command: string; args: string[] } | null> {
  // 检查已安装的 gopls
  const goplsPath = getInstalledServerPath('go')

  if (goplsPath) {
    return { command: goplsPath, args: [] }
  }

  // 检查系统 PATH
  if (commandExists('gopls')) {
    return { command: 'gopls', args: [] }
  }

  // 检查 GOPATH/bin
  const goplsName = getExecutableName('gopls')
  const goPathBin = process.env.GOPATH ? path.join(process.env.GOPATH, 'bin', goplsName) : null

  if (goPathBin && fs.existsSync(goPathBin)) {
    return { command: goPathBin, args: [] }
  }

  return null
}

// Rust LSP (rust-analyzer)
async function getRustAnalyzerCommand(): Promise<{ command: string; args: string[] } | null> {
  const serverPath = getInstalledServerPath('rust')
  return serverPath ? { command: serverPath, args: [] } : null
}

// Java LSP (Eclipse JDT LS)
async function getJdtlsCommand(workspacePath: string): Promise<{ command: string; args: string[] } | null> {
  const serverPath = getInstalledServerPath('jdtls')
  if (!serverPath) return null

  const dataDir = path.join(
    getLspBinDir(),
    'jdtls-workspaces',
    createHash('sha1').update(path.resolve(workspacePath)).digest('hex'),
  )
  fs.mkdirSync(dataDir, { recursive: true })

  // System packages commonly expose a wrapper executable.
  if (!serverPath.toLowerCase().endsWith('.jar')) {
    return { command: serverPath, args: ['-data', dataDir] }
  }

  const configuredRuntime = resolveRuntimePath(workspacePath, 'java')
  const javaExecutableName = process.platform === 'win32' ? 'java.exe' : 'java'
  const javaExecutable = fs.existsSync(configuredRuntime) && fs.statSync(configuredRuntime).isDirectory()
    ? path.join(configuredRuntime, 'bin', javaExecutableName)
    : configuredRuntime
  const jdtlsRoot = path.resolve(path.dirname(serverPath), '..')
  const platformConfig = process.platform === 'win32'
    ? 'config_win'
    : process.platform === 'darwin' ? 'config_mac' : 'config_linux'

  return {
    command: javaExecutable,
    args: [
      '-Declipse.application=org.eclipse.jdt.ls.core.id1',
      '-Dosgi.bundles.defaultStartLevel=4',
      '-Declipse.product=org.eclipse.jdt.ls.core.product',
      '-Dlog.level=INFO',
      '-Xmx1G',
      '--add-modules=ALL-SYSTEM',
      '--add-opens', 'java.base/java.util=ALL-UNNAMED',
      '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
      '-jar', serverPath,
      '-configuration', path.join(jdtlsRoot, platformConfig),
      '-data', dataDir,
    ],
  }
}

// C/C++ LSP (clangd)
async function getClangdCommand(): Promise<{ command: string; args: string[] } | null> {
  if (commandExists('clangd')) {
    return { command: 'clangd', args: ['--background-index', '--clang-tidy'] }
  }

  return null
}

// Vue LSP (vue-language-server)
async function getVueServerCommand(): Promise<{ command: string; args: string[] } | null> {
  const serverPath = getInstalledServerPath('vue')
  if (serverPath) return { command: process.execPath, args: [serverPath, '--stdio'] }

  // 尝试全局安装的 vue-language-server
  if (commandExists('vue-language-server')) {
    return { command: 'vue-language-server', args: ['--stdio'] }
  }

  return null
}

// Zig LSP (zls)
async function getZlsCommand(): Promise<{ command: string; args: string[] } | null> {
  const zlsPath = getInstalledServerPath('zig')
  if (zlsPath) return { command: zlsPath, args: [] }

  if (commandExists('zls')) {
    return { command: 'zls', args: [] }
  }

  return null
}

// C# LSP (csharp-ls)
async function getCsharpLsCommand(): Promise<{ command: string; args: string[] } | null> {
  const serverPath = getInstalledServerPath('csharp')
  if (serverPath) return { command: serverPath, args: [] }

  if (commandExists('csharp-ls')) {
    return { command: 'csharp-ls', args: [] }
  }

  return null
}

// Deno LSP
async function getDenoCommand(): Promise<{ command: string; args: string[] } | null> {
  if (commandExists('deno')) {
    return { command: 'deno', args: ['lsp'] }
  }

  return null
}

// PHP LSP (intelephense)
async function getPhpServerCommand(): Promise<{ command: string; args: string[] } | null> {
  const serverPath = getInstalledServerPath('php')
  if (serverPath) {
    return { command: process.execPath, args: [serverPath, '--stdio'] }
  }

  // 检查全局安装的 intelephense
  if (commandExists('intelephense')) {
    return { command: 'intelephense', args: ['--stdio'] }
  }

  return null
}

// ============ 服务器配置 ============

const LSP_SERVERS: LspServerConfig[] = [
  {
    name: 'typescript',
    getCommand: getTypeScriptServerCommand,
    // 智能根目录检测：查找 package.json 或 lock 文件，排除 deno 项目
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const root = await findNearestRoot(
        fileDir,
        workspacePath,
        ['package-lock.json', 'bun.lockb', 'bun.lock', 'pnpm-lock.yaml', 'yarn.lock', 'package.json'],
        ['deno.json', 'deno.jsonc'] // 排除 Deno 项目
      )
      return root || workspacePath
    },
  },
  {
    name: 'html',
    getCommand: getHtmlServerCommand,
  },
  {
    name: 'css',
    getCommand: getCssServerCommand,
  },
  {
    name: 'json',
    getCommand: getJsonServerCommand,
  },
  {
    name: 'python',
    getCommand: getPythonServerCommand,
    // 智能根目录检测：查找 Python 项目配置文件
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const root = await findNearestRoot(
        fileDir,
        workspacePath,
        ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile', 'pyrightconfig.json']
      )
      return root || workspacePath
    },
  },
  {
    name: 'go',
    getCommand: getGoplsCommand,
    // 智能根目录检测：优先查找 go.work，然后 go.mod
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      // 先查找 go.work（工作区模式）
      const workRoot = await findNearestRoot(fileDir, workspacePath, ['go.work'])
      if (workRoot) return workRoot
      // 再查找 go.mod
      const modRoot = await findNearestRoot(fileDir, workspacePath, ['go.mod', 'go.sum'])
      return modRoot || workspacePath
    },
  },
  {
    name: 'rust',
    getCommand: getRustAnalyzerCommand,
    // 智能根目录检测：查找 Cargo.toml，优先查找 workspace
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const crateRoot = await findNearestRoot(fileDir, workspacePath, ['Cargo.toml', 'Cargo.lock'])
      if (!crateRoot) return workspacePath

      // 向上查找 workspace 根目录
      let currentDir = crateRoot
      while (currentDir.length >= workspacePath.length) {
        const cargoTomlPath = path.join(currentDir, 'Cargo.toml')
        if (fs.existsSync(cargoTomlPath)) {
          try {
            const content = fs.readFileSync(cargoTomlPath, 'utf-8')
            if (content.includes('[workspace]')) {
              return currentDir
            }
          } catch { /* Unreadable ancestor directories cannot provide a project marker. */ }
        }
        const parentDir = path.dirname(currentDir)
        if (parentDir === currentDir) break
        currentDir = parentDir
      }

      return crateRoot
    },
  },
  {
    name: 'jdtls',
    getCommand: getJdtlsCommand,
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const root = await findNearestRoot(
        fileDir,
        workspacePath,
        ['pom.xml', 'mvnw', 'gradlew', 'settings.gradle', 'settings.gradle.kts', 'build.gradle', 'build.gradle.kts']
      )
      return root || workspacePath
    },
  },
  {
    name: 'clangd',
    getCommand: getClangdCommand,
    // 智能根目录检测：查找编译数据库或构建配置
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const root = await findNearestRoot(
        fileDir,
        workspacePath,
        ['compile_commands.json', 'compile_flags.txt', '.clangd', 'CMakeLists.txt', 'Makefile']
      )
      return root || workspacePath
    },
  },
  {
    name: 'vue',
    getCommand: getVueServerCommand,
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const root = await findNearestRoot(
        fileDir,
        workspacePath,
        ['package-lock.json', 'bun.lockb', 'bun.lock', 'pnpm-lock.yaml', 'yarn.lock', 'package.json']
      )
      return root || workspacePath
    },
  },
  {
    name: 'zig',
    getCommand: getZlsCommand,
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const root = await findNearestRoot(fileDir, workspacePath, ['build.zig', 'build.zig.zon'])
      return root || workspacePath
    },
  },
  {
    name: 'csharp',
    getCommand: getCsharpLsCommand,
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const root = await findNearestRoot(fileDir, workspacePath, ['*.sln', '*.csproj'])
      return root || workspacePath
    },
  },
  {
    name: 'deno',
    getCommand: getDenoCommand,
    // Deno 项目检测：查找 deno.json 或 deno.jsonc
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const root = await findNearestRoot(fileDir, workspacePath, ['deno.json', 'deno.jsonc'])
      return root || null // 找不到 deno.json 返回 null，表示不应该使用 Deno LSP
    },
  },
  {
    name: 'php',
    getCommand: getPhpServerCommand,
    // 智能根目录检测：查找 PHP 项目配置文件
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const root = await findNearestRoot(
        fileDir,
        workspacePath,
        ['composer.json', 'composer.lock', 'phpunit.xml', 'phpstan.neon']
      )
      return root || workspacePath
    },
  },
]

// ============ LSP 管理器 ============

class LspManager {
  private servers: Map<string, LspServerInstance> = new Map() // key: serverName:workspacePath
  private languageToServer: Map<LanguageId, LspServerId> = new Map()
  private documentVersions: Map<string, number> = new Map() // 启用文档版本管理
  private diagnosticsCache: CacheService<any[]>
  private startingServers: Map<string, Promise<boolean>> = new Map()
  private inFlightReadRequests = new Map<string, Promise<any>>()
  private serverRouteCache = new Map<string, { expiresAt: number; route: Promise<ResolvedServerRoute> }>()
  private static readonly SERVER_ROUTE_CACHE_TTL_MS = 30_000
  private static readonly SERVER_ROUTE_CACHE_MAX_SIZE = 500

  // 跟踪每个服务器打开的文档
  private serverOpenedDocuments: Map<string, Map<string, { languageId: string; version: number; text: string }>> = new Map()
  private documentOwnership = new DocumentOwnership()

  // 空闲关闭配置
  private serverLastActivity: Map<string, number> = new Map()
  private idleCheckInterval: NodeJS.Timeout | null = null
  private static readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 分钟无活动则关闭

  // 自动重启配置
  private static readonly MAX_CRASH_COUNT = 3
  private static readonly CRASH_COOLDOWN_MS = LSP_DEFAULTS.crashCooldownMs
  private crashStates = new Map<string, CrashState>()
  private stoppingServers = new Set<string>()

  // waitForDiagnostics 相关
  private diagnosticsWaiters: Map<string, { resolve: () => void; timeout: NodeJS.Timeout }[]> = new Map()
  private static readonly DIAGNOSTICS_DEBOUNCE_MS = 100
  private static readonly DIAGNOSTICS_TIMEOUT_MS = 3000

  // 记录启动失败的冷却时间（防止无限重试轰炸日志）
  private unavailableServers: Map<string, number> = new Map()

  constructor() {
    // 初始化诊断缓存
    const cacheConfig = getCacheConfig('lspDiagnostics')
    this.diagnosticsCache = new CacheService<any[]>('LspDiagnostics', {
      maxSize: cacheConfig.maxSize,
      defaultTTL: cacheConfig.ttlMs,
      evictionPolicy: cacheConfig.evictionPolicy || 'lru',
      cleanupInterval: cacheConfig.cleanupInterval || 0,
    })

    for (const definition of LSP_SERVER_DEFINITIONS) {
      for (const languageId of definition.languages) {
        this.languageToServer.set(languageId, definition.id)
      }
    }

    // 启动空闲检查定时器
    this.startIdleCheck()
  }

  /**
   * 设置诊断缓存
   */
  private setDiagnosticsCache(uri: string, diagnostics: any[]): void {
    this.diagnosticsCache.set(uri, diagnostics)
  }

  private startIdleCheck() {
    if (this.idleCheckInterval) return

    this.idleCheckInterval = setInterval(() => {
      const now = Date.now()
      for (const [key, lastActivity] of this.serverLastActivity) {
        if (now - lastActivity > LspManager.IDLE_TIMEOUT_MS) {
          const instance = this.servers.get(key)
          if (instance && instance.initialized) {
            logger.lsp.info(`[LSP ${key}] Stopping idle server (inactive for ${Math.round((now - lastActivity) / 1000)}s)`)
            this.stopServerByKey(key)
          }
        }
      }
    }, 60000) // 每分钟检查一次
  }

  private updateActivity(key: string) {
    this.serverLastActivity.set(key, Date.now())
  }

  private getInstanceKey(serverName: string, workspacePath: string): string {
    return `${serverName}:${workspacePath.replace(/\\/g, '/')}`
  }

  getServerForLanguage(languageId: LanguageId): LspServerId | undefined {
    return this.languageToServer.get(languageId)
  }

  async startServer(serverName: string, workspacePath: string): Promise<boolean> {
    const key = this.getInstanceKey(serverName, workspacePath)
    const existing = this.servers.get(key)

    if (existing?.process && existing.initialized) return true

    // 如果最近短时间内启动失败过，直接返回避免刷日志 (冷却时间 60s)
    const lastFailed = this.unavailableServers.get(key)
    if (lastFailed && Date.now() - lastFailed < 60000) {
      return false
    }

    const pendingStart = this.startingServers.get(key)
    if (pendingStart) return pendingStart

    const config = LSP_SERVERS.find(c => c.name === serverName)
    if (!config) return false

    const startPromise = this.spawnServer(config, workspacePath)
      .then(success => {
        if (!success) this.unavailableServers.set(key, Date.now())
        else this.unavailableServers.delete(key)
        return success
      })
    this.startingServers.set(key, startPromise)
    try {
      return await startPromise
    } finally {
      this.startingServers.delete(key)
    }
  }

  private async spawnServer(config: LspServerConfig, workspacePath: string): Promise<boolean> {
    const cmdInfo = await config.getCommand(workspacePath)
    if (!cmdInfo) {
      logger.lsp.warn(`[LSP ${config.name}] No command available for server`)
      return false
    }

    const { command, args } = cmdInfo
    const key = this.getInstanceKey(config.name, workspacePath)

    // 使用 ELECTRON_RUN_AS_NODE=1 让 Electron 作为纯 Node.js 运行时工作
    const languageEnv = getLanguageEnv(workspacePath, config.name)
    const extraPathEnv = languageEnv?.extraPaths?.length
      ? languageEnv.extraPaths.join(path.delimiter)
      : undefined
    const proc = spawn(command, args, {
      cwd: workspacePath,
      env: {
        ...process.env,
        ...languageEnv?.env,
        ...(extraPathEnv ? {
          PYTHONPATH: [extraPathEnv, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
        } : {}),
        ELECTRON_RUN_AS_NODE: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    if (!proc.stdout || !proc.stdin) return false

    const instance: LspServerInstance = {
      config,
      process: proc,
      requestId: 0,
      pendingRequests: new Map(),
      buffer: Buffer.alloc(0),
      contentLength: -1,
      initialized: false,
      workspacePath,
    }

    this.servers.set(key, instance)

    logger.lsp.debug(`[LSP ${key}] Starting process: ${command} ${args.join(' ')}`)

    proc.on('error', (err) => {
      logger.lsp.error(`[LSP ${key}] Process spawn error:`, toAppError(err).message)
    })

    proc.stdout.on('data', (data: Buffer) => this.handleServerOutput(key, data))
    proc.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim()
      if (msg) logger.lsp.warn(`[LSP ${key}] STDERR:`, msg)
    })

    proc.on('close', (code) => {
      logger.lsp.debug(`[LSP ${key}] Closed with code: ${code}`)
      this.rejectPendingRequests(instance, new Error(`LSP server ${key} exited with code ${code ?? 'unknown'}`))
      if (this.servers.get(key) === instance) this.servers.delete(key)

      const stoppedIntentionally = this.stoppingServers.delete(key)
      if (!stoppedIntentionally && code !== 0 && code !== null) {
        this.scheduleRestart(key, instance)
      }
    })

    proc.stdin.on('error', (err) => {
      const error = toAppError(err)
      logger.lsp.warn(`[LSP ${key}] stdin error:`, error.message)
      this.rejectPendingRequests(instance, error)
    })

    try {
      await this.initializeServer(key, workspacePath)
      instance.initialized = true
      this.restoreOpenedDocuments(key)
      logger.lsp.debug(`[LSP ${key}] Initialized successfully`)
      return true
    } catch (err) {
      logger.lsp.error(`[LSP ${key}] Init failed:`, toAppError(err).message)
      this.stopServerByKey(key)
      return false
    }
  }

  private handleServerOutput(key: string, data: Buffer): void {
    const instance = this.servers.get(key)
    if (!instance) return

    instance.buffer = Buffer.concat([instance.buffer, data])

    for (;;) {
      if (instance.contentLength === -1) {
        const headerEnd = instance.buffer.indexOf('\r\n\r\n')
        if (headerEnd === -1) return

        const header = instance.buffer.slice(0, headerEnd).toString('utf8')
        const match = header.match(/Content-Length:\s*(\d+)/i)
        if (match) {
          instance.contentLength = parseInt(match[1], 10)
          instance.buffer = instance.buffer.slice(headerEnd + 4)
        } else {
          instance.buffer = instance.buffer.slice(headerEnd + 4)
          continue
        }
      }

      if (instance.contentLength === -1 || instance.buffer.length < instance.contentLength) return

      const message = instance.buffer.slice(0, instance.contentLength).toString('utf8')
      instance.buffer = instance.buffer.slice(instance.contentLength)
      instance.contentLength = -1

      try {
        this.handleServerMessage(key, JSON.parse(message))
      } catch { /* Ignore a malformed server message and continue reading the next frame. */ }
    }
  }

  private handleServerMessage(key: string, message: JsonRpcMessage): void {
    const instance = this.servers.get(key)
    if (!instance) return

    if (
      isClientResponse(message)
      && typeof message.id === 'number'
      && instance.pendingRequests.has(message.id)
    ) {
      const { resolve, reject, timeout } = instance.pendingRequests.get(message.id)!
      instance.pendingRequests.delete(message.id)
      clearTimeout(timeout)
      if (message.error) {
        const responseError = new Error(
          typeof message.error.message === 'string'
            ? message.error.message
            : `LSP request failed with code ${message.error.code ?? 'unknown'}`
        ) as Error & { code?: number; data?: unknown }
        if (typeof message.error.code === 'number') responseError.code = message.error.code
        if (message.error.data !== undefined) responseError.data = message.error.data
        reject(responseError)
      }
      else resolve(message.result)
    } else if (isServerRequest(message)) {
      this.handleServerRequest(key, instance, message)
    } else if (isServerNotification(message)) {
      this.handleNotification(key, message)
    }
  }

  private handleServerRequest(
    key: string,
    instance: LspServerInstance,
    message: JsonRpcMessage,
  ): void {
    const id = message.id!

    if (message.method === 'workspace/configuration') {
      const params = message.params as { items?: Array<{ section?: string }> } | undefined
      const settings = (params?.items ?? []).map((item) => {
        const section = item.section || ''

        // Python (Pyright) — 使用检测到的虚拟环境路径
        if (section === 'python.analysis') {
          return getPythonAnalysisSettings(instance.workspacePath)
        }
        if (section === 'python' || section.startsWith('python.')) {
          return {
            pythonPath: getPythonPathForWorkspace(instance.workspacePath),
            analysis: getPythonAnalysisSettings(instance.workspacePath),
          }
        }

        // Rust (rust-analyzer)
        if (section === 'rust-analyzer' || section.startsWith('rust-analyzer.')) {
          return {
            checkOnSave: {
              command: 'clippy'
            },
            cargo: {
              allFeatures: false
            },
            procMacro: {
              enable: true
            }
          }
        }

        // PHP (Intelephense)
        if (section === 'intelephense' || section.startsWith('intelephense.')) {
          return {
            files: {
              maxSize: 1000000
            },
            diagnostics: {
              enable: true
            },
            completion: {
              insertUseDeclaration: true,
              fullyQualifyGlobalConstantsAndFunctions: false
            }
          }
        }

        // Vue
        if (section === 'vue' || section.startsWith('volar.')) {
          return {
            server: {
              hybridMode: false
            }
          }
        }

        return null
      })

      this.writeMessage(key, instance, createJsonRpcResult(id, settings))
      return
    }

    if (
      message.method === 'client/registerCapability'
      || message.method === 'client/unregisterCapability'
      || message.method === 'window/workDoneProgress/create'
      || message.method === 'window/showMessageRequest'
    ) {
      this.writeMessage(key, instance, createJsonRpcResult(id, null))
      return
    }

    if (message.method === 'workspace/applyEdit') {
      this.writeMessage(key, instance, createJsonRpcResult(id, {
        applied: false,
        failureReason: 'Client does not support server-initiated workspace edits',
      }))
      return
    }

    if (message.method === 'workspace/workspaceFolders') {
      this.writeMessage(key, instance, createJsonRpcResult(id, [{
        uri: pathToLspUri(instance.workspacePath),
        name: path.basename(instance.workspacePath),
      }]))
      return
    }

    this.writeMessage(
      key,
      instance,
      createJsonRpcError(id, JSON_RPC_METHOD_NOT_FOUND, `Unsupported server request: ${message.method}`),
    )
  }

  private handleNotification(key: string, message: JsonRpcMessage): void {
    if (message.method === 'textDocument/publishDiagnostics') {
      const { uri: rawUri, diagnostics } = message.params as { uri: string; diagnostics: any[] }

      // 规范化 URI：处理不同 LSP 服务器返回的 URI 格式差异
      const uri = normalizeLspUri(rawUri)

      this.setDiagnosticsCache(uri, diagnostics)

      // 通知等待诊断的调用者
      this.notifyDiagnosticsWaiters(uri)

      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          try {
            win.webContents.send('lsp:diagnostics', { uri, diagnostics, serverKey: key })
          } catch { /* The renderer may close before diagnostics are delivered. */ }
        }
      })
    }
  }

  /**
   * 通知等待诊断的调用者（带防抖）
   */
  private notifyDiagnosticsWaiters(uri: string): void {
    const waiters = this.diagnosticsWaiters.get(uri)
    if (!waiters || waiters.length === 0) return

    // 使用防抖，等待 LSP 发送后续诊断（如语义诊断在语法诊断之后）
    for (const waiter of waiters) {
      clearTimeout(waiter.timeout)
      waiter.timeout = setTimeout(() => {
        waiter.resolve()
        // 从等待列表中移除
        const idx = waiters.indexOf(waiter)
        if (idx >= 0) waiters.splice(idx, 1)
        if (waiters.length === 0) this.diagnosticsWaiters.delete(uri)
      }, LspManager.DIAGNOSTICS_DEBOUNCE_MS)
    }
  }

  /**
   * 等待指定文件的诊断信息
   */
  async waitForDiagnostics(uri: string): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // 超时后自动 resolve
        const waiters = this.diagnosticsWaiters.get(uri)
        if (waiters) {
          const idx = waiters.findIndex(w => w.resolve === resolve)
          if (idx >= 0) waiters.splice(idx, 1)
          if (waiters.length === 0) this.diagnosticsWaiters.delete(uri)
        }
        resolve()
      }, LspManager.DIAGNOSTICS_TIMEOUT_MS)

      if (!this.diagnosticsWaiters.has(uri)) {
        this.diagnosticsWaiters.set(uri, [])
      }
      this.diagnosticsWaiters.get(uri)!.push({ resolve, timeout })
    })
  }

  sendRequest(key: string, method: string, params: any, timeoutMs = 30000): Promise<any> {
    // 更新活动时间
    this.updateActivity(key)

    const execute = async () => {
      try {
        return await this.sendRequestOnce(key, method, params, timeoutMs)
      } catch (error) {
        if (!shouldRetryContentModified(method, error)) throw error
        return this.sendRequestOnce(key, method, params, timeoutMs)
      }
    }

    if (!isCoalescibleReadMethod(method)) return execute()
    const requestKey = `${key}\0${method}\0${JSON.stringify(params)}`
    const existing = this.inFlightReadRequests.get(requestKey)
    if (existing) return existing

    const request = execute().finally(() => {
      if (this.inFlightReadRequests.get(requestKey) === request) {
        this.inFlightReadRequests.delete(requestKey)
      }
    })
    this.inFlightReadRequests.set(requestKey, request)
    return request
  }

  private sendRequestOnce(key: string, method: string, params: any, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const instance = this.servers.get(key)
      if (!instance?.process?.stdin || !instance.process.stdin.writable) {
        reject(new Error(`Server ${key} not running`))
        return
      }

      const id = ++instance.requestId
      const timeout = setTimeout(() => {
        instance.pendingRequests.delete(id)
        this.writeMessage(key, instance, {
          jsonrpc: '2.0',
          method: '$/cancelRequest',
          params: { id },
        })
        reject(new Error(`Request ${method} timed out`))
      }, timeoutMs)

      instance.pendingRequests.set(id, { resolve, reject, timeout })

      try {
        instance.process.stdin.write(encodeLspMessage({ jsonrpc: '2.0', id, method, params }))
      } catch (err) {
        instance.pendingRequests.delete(id)
        clearTimeout(timeout)
        reject(err)
      }
    })
  }

  sendNotification(key: string, method: string, params: any): void {
    // 更新活动时间
    this.updateActivity(key)

    const instance = this.servers.get(key)
    if (!instance?.process?.stdin || !instance.process.stdin.writable) return

    this.writeMessage(key, instance, { jsonrpc: '2.0', method, params })
  }

  private writeMessage(key: string, instance: LspServerInstance, payload: JsonRpcMessage): boolean {
    const stdin = instance.process?.stdin
    if (!stdin?.writable) return false

    try {
      stdin.write(encodeLspMessage(payload))
      return true
    } catch (error) {
      logger.lsp.error(`[LSP ${key}] Failed to write message:`, toAppError(error).message)
      return false
    }
  }

  private rejectPendingRequests(instance: LspServerInstance, reason: Error): void {
    for (const pending of instance.pendingRequests.values()) {
      clearTimeout(pending.timeout)
      pending.reject(reason)
    }
    instance.pendingRequests.clear()
  }

  private scheduleRestart(key: string, instance: LspServerInstance): void {
    const now = Date.now()
    const previous = this.crashStates.get(key)
    const count = previous && now - previous.lastCrashTime <= LspManager.CRASH_COOLDOWN_MS
      ? previous.count + 1
      : 1
    if (previous?.restartTimer) clearTimeout(previous.restartTimer)

    const state: CrashState = { count, lastCrashTime: now }
    this.crashStates.set(key, state)
    if (count > LspManager.MAX_CRASH_COUNT) {
      logger.lsp.error(`[LSP ${key}] Server crashed ${count} times, giving up`)
      return
    }

    const delay = Math.min(1000 * count, 5000)
    logger.lsp.warn(`[LSP ${key}] Server crashed (${count}/${LspManager.MAX_CRASH_COUNT}), restarting in ${delay}ms...`)
    state.restartTimer = setTimeout(() => {
      state.restartTimer = undefined
      if (this.stoppingServers.has(key) || this.servers.has(key)) return
      this.startServer(instance.config.name, instance.workspacePath).catch(error => {
        logger.lsp.error(`[LSP ${key}] Restart failed:`, error)
      })
    }, delay)
  }

  private restoreOpenedDocuments(key: string): void {
    const documents = this.serverOpenedDocuments.get(key)
    if (!documents?.size) return

    for (const [uri, document] of documents) {
      this.sendNotification(key, 'textDocument/didOpen', {
        textDocument: { uri, ...document },
      })
    }
  }

  private async initializeServer(key: string, workspacePath: string): Promise<void> {
    const rootUri = pathToLspUri(workspacePath)

    const instance = this.servers.get(key)
    const serverName = instance?.config.name

    // 为 Pyright 添加 Python 解释器配置（自动检测虚拟环境）
    const initializationOptions = serverName === 'python'
      ? { python: { pythonPath: getPythonPathForWorkspace(workspacePath) } }
      : serverName === 'typescript'
        ? getTypeScriptInitializationOptions(workspacePath)
        : undefined

    await this.sendRequest(key, 'initialize', {
      processId: process.pid,
      rootUri,
      capabilities: this.getClientCapabilities(),
      workspaceFolders: [{ uri: rootUri, name: path.basename(workspacePath) }],
      ...(initializationOptions && { initializationOptions }),
    }, 60000)

    this.sendNotification(key, 'initialized', {})

    // 为 Pyright 发送配置
    if (serverName === 'python') {
      const pythonPath = getPythonPathForWorkspace(workspacePath)
      this.sendNotification(key, 'workspace/didChangeConfiguration', {
        settings: {
          python: {
            pythonPath,
            analysis: getPythonAnalysisSettings(workspacePath),
          }
        }
      })
    }
  }

  private getClientCapabilities(): any {
    return {
      textDocument: {
        synchronization: { openClose: true, change: 2, save: { includeText: true } },
        completion: { completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'] }, contextSupport: true },
        hover: { contentFormat: ['markdown', 'plaintext'] },
        signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'] } },
        definition: { linkSupport: true },
        typeDefinition: { linkSupport: true },
        implementation: { linkSupport: true },
        references: {},
        documentHighlight: {},
        documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ['quickfix', 'refactor', 'source'] } } },
        formatting: {},
        rangeFormatting: {},
        rename: { prepareSupport: true },
        foldingRange: {},
        publishDiagnostics: { relatedInformation: true },
        // Call Hierarchy 支持
        callHierarchy: {
          dynamicRegistration: false,
        },
        // Inlay Hints 支持
        inlayHint: {
          dynamicRegistration: false,
        },
      },
      workspace: {
        workspaceFolders: true,
        applyEdit: false,
        configuration: true,
        // 文件监视支持
        didChangeWatchedFiles: {
          dynamicRegistration: false,
        },
      },
    }
  }

  async stopServerByKey(key: string): Promise<void> {
    const instance = this.servers.get(key)
    if (!instance?.process) return
    this.stoppingServers.add(key)
    const crashState = this.crashStates.get(key)
    if (crashState?.restartTimer) clearTimeout(crashState.restartTimer)
    this.crashStates.delete(key)

    // 清除该服务器相关的诊断缓存（按前缀删除）
    const workspaceUri = pathToLspUri(instance.workspacePath)

    // 获取要删除的 URI 列表
    const urisToDelete = this.diagnosticsCache.keys().filter(
      uri => uri === workspaceUri || uri.startsWith(`${workspaceUri}/`)
    )

    for (const uri of urisToDelete) {
      this.diagnosticsCache.delete(uri)
      // 通知前端清除诊断
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          try {
            win.webContents.send('lsp:diagnostics', { uri, diagnostics: [], serverKey: key })
          } catch { /* A closing renderer no longer needs cleared diagnostics. */ }
        }
      })
    }

    // 清除文档跟踪（服务器关闭后文档状态无效）
    this.serverOpenedDocuments.delete(key)
    this.documentOwnership.clearServer(key)

    try {
      await this.sendRequest(key, 'shutdown', null, 3000)
      this.sendNotification(key, 'exit', null)
    } catch { /* Continue process cleanup when the server does not acknowledge shutdown. */ }
    this.rejectPendingRequests(instance, new Error(`LSP server ${key} stopped`))
    const processClosed = instance.process.exitCode !== null
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 2000)
        instance.process!.once('close', () => {
          clearTimeout(timeout)
          resolve()
        })
      })
    instance.process.kill()
    await processClosed
    this.servers.delete(key)
    this.serverLastActivity.delete(key)

    logger.lsp.info(`[LSP ${key}] Server stopped and diagnostics cleared`)
  }

  async stopAllServers(): Promise<void> {
    // 停止空闲检查
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval)
      this.idleCheckInterval = null
    }
    await Promise.all(Array.from(this.servers.keys()).map(key => this.stopServerByKey(key)))
  }

  async ensureServerForLanguage(languageId: LanguageId, workspacePath: string): Promise<string | null> {
    const serverName = this.getServerForLanguage(languageId)
    if (!serverName) return null
    const success = await this.startServer(serverName, workspacePath)
    return success ? this.getInstanceKey(serverName, workspacePath) : null
  }

  /**
   * 清除指定服务器的 unavailable 冷却标记（安装后调用）
   */
  clearUnavailable(serverName?: string): void {
    if (serverName) {
      for (const key of this.unavailableServers.keys()) {
        if (key.startsWith(serverName + ':')) {
          this.unavailableServers.delete(key)
        }
      }
    } else {
      this.unavailableServers.clear()
    }
  }

  getRunningServers(workspacePath?: string): string[] {
    if (!workspacePath) return Array.from(this.servers.keys())

    const requestedRoot = path.resolve(workspacePath)
    return Array.from(this.servers.entries())
      .filter(([, instance]) => {
        const relative = path.relative(requestedRoot, path.resolve(instance.workspacePath))
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
      })
      .map(([key]) => key)
  }

  getDiagnostics(uri: string): any[] {
    return this.diagnosticsCache.get(uri) ?? []
  }

  getDiagnosticsCacheStats() {
    return this.diagnosticsCache.getStats()
  }

  // 文档版本管理
  getDocumentVersion(uri: string): number {
    return this.documentVersions.get(uri) || 0
  }

  incrementDocumentVersion(uri: string): number {
    const current = this.documentVersions.get(uri) || 0
    const next = current + 1
    this.documentVersions.set(uri, next)
    return next
  }

  resetDocumentVersion(uri: string): void {
    this.documentVersions.delete(uri)
  }

  syncDocument(
    serverKey: string,
    uri: string,
    languageId: string,
    text: string,
    ownerId: number,
  ): DocumentSyncResult {
    this.documentOwnership.acquire(serverKey, uri, ownerId)
    let documents = this.serverOpenedDocuments.get(serverKey)
    if (!documents) {
      documents = new Map()
      this.serverOpenedDocuments.set(serverKey, documents)
    }

    const existing = documents.get(uri)
    if (!existing) {
      documents.set(uri, { languageId, version: 1, text })
      return { action: 'open', version: 1 }
    }
    if (existing.text === text) return { action: 'none', version: existing.version }

    existing.version++
    existing.languageId = languageId
    existing.text = text
    return { action: 'change', version: existing.version }
  }

  releaseDocument(serverKey: string, uri: string, ownerId: number): boolean {
    const shouldClose = this.documentOwnership.release(serverKey, uri, ownerId)
    if (shouldClose) this.serverOpenedDocuments.get(serverKey)?.delete(uri)
    return shouldClose
  }

  releaseDocumentForOwner(uri: string, ownerId: number): ReleasedDocument[] {
    const released = this.documentOwnership.releaseOwnerDocument(ownerId, uri)
    for (const { serverKey, uri: releasedUri } of released) {
      this.serverOpenedDocuments.get(serverKey)?.delete(releasedUri)
    }
    return released
  }

  releaseDocumentOwner(ownerId: number): ReleasedDocument[] {
    const released = this.documentOwnership.releaseOwner(ownerId)
    for (const { serverKey, uri } of released) {
      this.serverOpenedDocuments.get(serverKey)?.delete(uri)
    }
    return released
  }

  // ============ Call Hierarchy 支持 ============

  /**
   * 准备调用层次结构
   * 返回指定位置的调用层次项
   */
  async prepareCallHierarchy(
    key: string,
    uri: string,
    line: number,
    character: number
  ): Promise<any[] | null> {
    try {
      const result = await this.sendRequest(key, 'textDocument/prepareCallHierarchy', {
        textDocument: { uri },
        position: { line, character },
      })
      return result || null
    } catch {
      return null
    }
  }

  /**
   * 获取调用当前函数的所有位置（谁调用了我）
   */
  async getIncomingCalls(key: string, item: any): Promise<any[] | null> {
    try {
      const result = await this.sendRequest(key, 'callHierarchy/incomingCalls', { item })
      return result || null
    } catch {
      return null
    }
  }

  /**
   * 获取当前函数调用的所有位置（我调用了谁）
   */
  async getOutgoingCalls(key: string, item: any): Promise<any[] | null> {
    try {
      const result = await this.sendRequest(key, 'callHierarchy/outgoingCalls', { item })
      return result || null
    } catch {
      return null
    }
  }

  // ============ 智能根目录检测 ============

  async resolveServerRouteForFile(
    filePath: string,
    languageId: LanguageId,
    workspacePath: string,
  ): Promise<ResolvedServerRoute | null> {
    const serverName = this.getServerForLanguage(languageId)
    if (!serverName) return null

    const cacheKey = [
      languageId,
      path.resolve(path.dirname(filePath)),
      path.resolve(workspacePath),
    ].join('\0')
    const cached = this.serverRouteCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.route
    if (cached) this.serverRouteCache.delete(cacheKey)

    const route = (async (): Promise<ResolvedServerRoute> => {
      try {
        if (serverName === 'typescript') {
          const denoConfig = LSP_SERVERS.find(config => config.name === 'deno')
          const denoRoot = await denoConfig?.findRoot?.(filePath, workspacePath)
          if (denoRoot) return { serverName: 'deno', workspacePath: denoRoot }
        }

        const config = LSP_SERVERS.find(candidate => candidate.name === serverName)
        const root = await config?.findRoot?.(filePath, workspacePath)
        return { serverName, workspacePath: root || workspacePath }
      } catch {
        return { serverName, workspacePath }
      }
    })()

    if (this.serverRouteCache.size >= LspManager.SERVER_ROUTE_CACHE_MAX_SIZE) {
      const oldestKey = this.serverRouteCache.keys().next().value
      if (oldestKey !== undefined) this.serverRouteCache.delete(oldestKey)
    }
    this.serverRouteCache.set(cacheKey, {
      expiresAt: Date.now() + LspManager.SERVER_ROUTE_CACHE_TTL_MS,
      route,
    })
    return route
  }

  async findBestRoot(filePath: string, languageId: LanguageId, workspacePath: string): Promise<string> {
    const route = await this.resolveServerRouteForFile(filePath, languageId, workspacePath)
    return route?.workspacePath || workspacePath
  }

  /**
   * 为指定文件启动 LSP 服务器（使用智能根目录检测）
   */
  async ensureServerForFile(filePath: string, languageId: LanguageId, workspacePath: string): Promise<string | null> {
    const route = await this.resolveServerRouteForFile(filePath, languageId, workspacePath)
    if (!route) return null

    const success = await this.startServer(route.serverName, route.workspacePath)
    return success ? this.getInstanceKey(route.serverName, route.workspacePath) : null
  }

  // ============ 文件监视通知 ============

  /**
   * 通知服务器文件变化
   */
  notifyDidChangeWatchedFiles(key: string, changes: Array<{ uri: string; type: number }>): void {
    this.sendNotification(key, 'workspace/didChangeWatchedFiles', { changes })
  }

  /**
   * 获取服务器配置
   */
  getServerConfig(serverName: string): LspServerConfig | undefined {
    return LSP_SERVERS.find(c => c.name === serverName)
  }

  /**
   * 获取所有支持的语言
   */
  getSupportedLanguages(): LanguageId[] {
    return Array.from(this.languageToServer.keys())
  }
}

export const lspManager = new LspManager()
