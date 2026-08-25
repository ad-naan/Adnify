/**
 * MCP 配置加载器
 * 负责加载和监听 MCP 配置文件
 * 支持本地和远程 MCP 服务器配置
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { logger } from '@shared/utils/Logger'
import { toAppError } from '@shared/utils/errorHandler'
import { getConfigFilePath, getWorkspaceConfigFilePath, CONFIG_FILES } from '../configPath'
import type { McpConfig, McpConfigProvider, McpServerConfig } from '@shared/types/mcp'
import { normalizeLocalCommandArgs } from './McpEnvHelper'

export class McpConfigLoader {
  private workspaceRoots: string[] = []
  private watchers: fs.FSWatcher[] = []
  private onConfigChange?: () => void
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  /** 获取 Adnify 默认用户配置路径 */
  private get userConfigPath(): string {
    return getConfigFilePath(CONFIG_FILES.MCP, CONFIG_FILES.SETTINGS_DIR)
  }

  /** 获取所有用户全局级候选 MCP 配置文件路径（按优先级从低到高） */
  private getExternalUserConfigPaths(): string[] {
    const homeDir = os.homedir()
    const paths: string[] = []

    // 1. Claude Desktop 配置
    if (process.platform === 'win32') {
      const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming')
      paths.push(path.join(appData, 'Claude', 'claude_desktop_config.json'))
    } else if (process.platform === 'darwin') {
      paths.push(path.join(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'))
    } else {
      paths.push(path.join(homeDir, '.config', 'Claude', 'claude_desktop_config.json'))
    }

    // 2. Claude Code 全局配置
    paths.push(path.join(homeDir, '.claude.json'))
    paths.push(path.join(homeDir, '.claude', 'mcp.json'))
    paths.push(path.join(homeDir, '.claude', 'settings.json'))

    // 3. Codex 全局配置
    paths.push(path.join(homeDir, '.codex', 'mcp.json'))

    // 4. Cursor 全局配置
    paths.push(path.join(homeDir, '.cursor', 'mcp.json'))

    return paths
  }

  /** 获取指定工作区的所有候选 MCP 配置文件路径（按优先级从低到高） */
  private getExternalWorkspaceConfigPaths(workspaceRoot: string): string[] {
    return [
      path.join(workspaceRoot, 'mcp.json'),
      path.join(workspaceRoot, '.vscode', 'mcp.json'),
      path.join(workspaceRoot, '.codex', 'mcp.json'),
      path.join(workspaceRoot, '.cursor', 'mcp.json'),
      path.join(workspaceRoot, '.claude', 'mcp.json'),
    ]
  }

  /** 设置工作区根目录 */
  setWorkspaceRoots(roots: string[]): void {
    this.workspaceRoots = roots
    this.setupWatchers()
  }

  /** 设置配置变更回调 */
  setOnConfigChange(callback: () => void): void {
    this.onConfigChange = callback
  }

  /** 日常运行只加载 Adnify 自己的全局和工作区配置。 */
  async loadConfig(): Promise<McpServerConfig[]> {
    const configMap = new Map<string, McpServerConfig>()

    const addConfig = (
      id: string,
      serverConfig: Record<string, any>,
      source: 'user' | 'workspace',
      configPath: string,
    ) => {
      const normalized = this.normalizeConfig(id, serverConfig, source, configPath)
      const previous = configMap.get(id)
      if (previous?.sourcePath && previous.sourceProvider && previous.source) {
        normalized.shadowedSources = [
          ...(previous.shadowedSources || []),
          { provider: previous.sourceProvider, path: previous.sourcePath, source: previous.source },
        ]
      }
      configMap.set(id, normalized)
    }

    const userConfig = await this.loadConfigFile(this.userConfigPath)
    if (userConfig?.mcpServers) {
      for (const [id, serverConfig] of Object.entries(userConfig.mcpServers)) {
        addConfig(id, serverConfig as Record<string, any>, 'user', this.userConfigPath)
      }
    }

    // 工作区 Adnify 配置覆盖全局 Adnify 同名配置。
    for (const root of this.workspaceRoots) {
      const workspaceConfigPath = this.getWorkspaceConfigPath(root)
      const workspaceConfig = await this.loadConfigFile(workspaceConfigPath)
      if (workspaceConfig?.mcpServers) {
        for (const [id, serverConfig] of Object.entries(workspaceConfig.mcpServers)) {
          addConfig(id, serverConfig as Record<string, any>, 'workspace', workspaceConfigPath)
        }
      }
    }

    const configs = Array.from(configMap.values())
    logger.mcp?.info(`[McpConfigLoader] Loaded ${configs.length} MCP server configs from Adnify directories`)
    return configs
  }

  /** 用户主动打开导入界面时才扫描第三方 Agent 配置；结果不参与运行。 */
  async discoverExternalConfigs(): Promise<McpServerConfig[]> {
    const configs: McpServerConfig[] = []
    const scan = async (configPath: string, source: 'user' | 'workspace') => {
      const file = await this.loadConfigFile(configPath)
      if (!file?.mcpServers) return
      for (const [id, serverConfig] of Object.entries(file.mcpServers)) {
        configs.push(this.normalizeConfig(id, serverConfig as Record<string, any>, source, configPath))
      }
    }

    for (const configPath of this.getExternalUserConfigPaths()) await scan(configPath, 'user')
    for (const root of this.workspaceRoots) {
      for (const configPath of this.getExternalWorkspaceConfigPaths(root)) await scan(configPath, 'workspace')
    }
    return configs
  }

  /** 自动推断配置的 type 字段，标记来源层级并规范化参数 */
  private normalizeConfig(
    id: string,
    serverConfig: Record<string, any>,
    source: 'user' | 'workspace',
    sourcePath: string,
  ): McpServerConfig {
    let type = serverConfig.type
    if (!type) {
      if ('url' in serverConfig) {
        type = 'remote'
      } else if ('command' in serverConfig) {
        type = 'local'
      }
    }

    let args = serverConfig.args
    if (type === 'local' && serverConfig.command && Array.isArray(args)) {
      args = normalizeLocalCommandArgs(serverConfig.command, args)
    }

    return {
      ...serverConfig,
      id,
      name: serverConfig.name || id,
      type,
      args,
      source,
      sourcePath,
      sourceProvider: this.resolveConfigProvider(sourcePath),
      shadowedSources: undefined,
    } as McpServerConfig
  }

  /** 保存用户级配置 */
  async saveUserConfig(config: McpConfig): Promise<void> {
    await this.saveConfigFile(this.userConfigPath, config)
  }

  /** 保存工作区配置 */
  async saveWorkspaceConfig(workspaceRoot: string, config: McpConfig): Promise<void> {
    const configPath = this.getWorkspaceConfigPath(workspaceRoot)
    await this.saveConfigFile(configPath, config)
  }

  /** 获取用户配置路径 */
  getUserConfigPath(): string {
    return this.userConfigPath
  }

  /** 获取工作区根目录列表 */
  getWorkspaceRoots(): string[] {
    return this.workspaceRoots
  }

  /** 获取工作区配置路径 */
  getWorkspaceConfigPath(workspaceRoot: string): string {
    return getWorkspaceConfigFilePath(workspaceRoot, CONFIG_FILES.MCP, CONFIG_FILES.SETTINGS_DIR)
  }

  /** 添加服务器到配置 */
  async addServer(serverConfig: McpServerConfig, level: 'user' | 'workspace' = 'user'): Promise<void> {
    const configPath = this.resolveConfigPath(level)
    const config = (await this.loadConfigFile(configPath)) || { mcpServers: {} }
    const {
      id,
      source: _source,
      sourcePath: _sourcePath,
      sourceProvider: _sourceProvider,
      shadowedSources: _shadowedSources,
      ...rest
    } = serverConfig
    config.mcpServers[id] = rest
    await this.saveConfigFile(configPath, config)
  }

  /** 从配置删除服务器 */
  async removeServer(serverId: string, level: 'user' | 'workspace' = 'user', sourcePath?: string): Promise<boolean> {
    const configPath = this.resolveWritableConfigPath(level, sourcePath)
    const config = await this.loadConfigFile(configPath)
    if (config && config.mcpServers[serverId]) {
      delete config.mcpServers[serverId]
      await this.saveConfigFile(configPath, config)
      return true
    }
    return false
  }

  /** 切换服务器启用/禁用状态 */
  async toggleServer(serverId: string, disabled: boolean, level: 'user' | 'workspace' = 'user', sourcePath?: string): Promise<boolean> {
    const configPath = this.resolveWritableConfigPath(level, sourcePath)
    const config = await this.loadConfigFile(configPath)
    if (config && config.mcpServers[serverId]) {
      config.mcpServers[serverId].disabled = disabled
      await this.saveConfigFile(configPath, config)
      return true
    }
    return false
  }

  /** 解析配置文件路径 */
  private resolveConfigPath(level: 'user' | 'workspace'): string {
    if (level === 'workspace' && this.workspaceRoots.length > 0) {
      return this.getWorkspaceConfigPath(this.workspaceRoots[0])
    }
    return this.userConfigPath
  }

  /** 只允许修改本加载器实际扫描的配置文件，避免 IPC 被用于写入任意路径。 */
  private resolveWritableConfigPath(level: 'user' | 'workspace', sourcePath?: string): string {
    if (!sourcePath) return this.resolveConfigPath(level)

    const knownPaths = [this.userConfigPath, ...this.workspaceRoots.map(root => this.getWorkspaceConfigPath(root))]
    const normalizedSource = path.resolve(sourcePath).toLowerCase()
    const matchedPath = knownPaths.find(candidate => path.resolve(candidate).toLowerCase() === normalizedSource)
    if (!matchedPath) {
      throw new Error(`Refusing to modify unknown MCP config path: ${sourcePath}`)
    }
    return matchedPath
  }

  private resolveConfigProvider(configPath: string): McpConfigProvider {
    const normalized = configPath.replace(/\\/g, '/').toLowerCase()
    if (path.resolve(configPath).toLowerCase() === path.resolve(this.userConfigPath).toLowerCase() || normalized.includes('/.adnify/')) return 'adnify'
    if (normalized.endsWith('/claude/claude_desktop_config.json')) return 'claude-desktop'
    if (normalized.includes('/.claude')) return 'claude-code'
    if (normalized.includes('/.codex/')) return 'codex'
    if (normalized.includes('/.cursor/')) return 'cursor'
    if (normalized.includes('/.vscode/')) return 'vscode'
    return 'generic'
  }

  /** 清理资源 */
  cleanup(): void {
    for (const watcher of this.watchers) {
      watcher.close()
    }
    this.watchers = []
  }

  // =================== 私有方法 ===================

  private async loadConfigFile(filePath: string): Promise<McpConfig | null> {
    try {
      try {
        await fs.promises.access(filePath, fs.constants.F_OK)
      } catch {
        return null
      }

      const content = await fs.promises.readFile(filePath, 'utf-8')
      const config = JSON.parse(content) as McpConfig

      if (!config.mcpServers || typeof config.mcpServers !== 'object') {
        logger.mcp?.debug(`[McpConfigLoader] Skipping non-MCP JSON file: ${filePath}`)
        return null
      }

      return config
    } catch (err) {
      const error = toAppError(err)
      logger.mcp?.error(`[McpConfigLoader] Failed to load config: ${filePath} - ${error.code}`, error)
      return null
    }
  }

  private async saveConfigFile(filePath: string, config: McpConfig): Promise<void> {
    try {
      const dir = path.dirname(filePath)
      await fs.promises.mkdir(dir, { recursive: true })

      const content = JSON.stringify(config, null, 2)
      await fs.promises.writeFile(filePath, content, 'utf-8')
      logger.mcp?.info(`[McpConfigLoader] Saved config: ${filePath}`)
    } catch (err) {
      const error = toAppError(err)
      logger.mcp?.error(`[McpConfigLoader] Failed to save config: ${filePath} - ${error.code}`, error)
      throw error
    }
  }

  private setupWatchers(): void {
    // 清理旧的 watchers
    this.cleanup()

    // 只监听 Adnify 自己的配置；第三方来源仅在用户主动导入时扫描。
    this.watchConfigFile(this.userConfigPath)

    for (const root of this.workspaceRoots) {
      this.watchConfigFile(this.getWorkspaceConfigPath(root))
    }
  }

  private watchConfigFile(filePath: string): void {
    const dir = path.dirname(filePath)
    const filename = path.basename(filePath)
    
    // 确保目录存在
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true })
      } catch {
        return
      }
    }

    try {
      const watcher = fs.watch(dir, (_eventType, changedFilename) => {
        if (changedFilename === filename) {
          logger.mcp?.info(`[McpConfigLoader] Config changed: ${filePath}`)
          // 延迟触发，避免频繁更新（防抖：清除前一个 timer）
          if (this.debounceTimer) clearTimeout(this.debounceTimer)
          this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null
            this.onConfigChange?.()
          }, 500)
        }
      })

      this.watchers.push(watcher)
    } catch (err) {
      const error = toAppError(err)
      logger.mcp?.warn(`[McpConfigLoader] Failed to watch: ${dir} - ${error.code}`, error)
    }
  }
}
