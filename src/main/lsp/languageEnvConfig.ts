/**
 * 语言环境配置模块
 * 
 * 管理每个工作区的语言运行时/解释器路径配置。
 * 支持手动指定和自动检测，优先级：手动配置 > 自动检测 > 系统默认。
 * 
 * 适用于所有需要指定运行时路径的语言：
 * - Python: 虚拟环境 / conda / pyenv
 * - Go: GOROOT / GOPATH
 * - Rust: toolchain 路径
 * - C/C++: 编译器路径
 * - 其他语言的解释器/SDK 路径
 */

import * as path from 'path'
import * as fs from 'fs'
import { homedir } from 'os'
import { logger } from '@shared/utils/Logger'
import { createScopedStore } from '../services/configPath'

// ============ 类型定义 ============

/** 单个语言的环境配置 */
export interface LanguageEnvEntry {
  /** 运行时/解释器路径（如 python.exe 的完整路径） */
  runtimePath?: string
  /** 额外的环境变量 */
  env?: Record<string, string>
  /** 额外的搜索路径（如 PYTHONPATH） */
  extraPaths?: string[]
}

/** 工作区级别的所有语言环境配置 */
export type WorkspaceLanguageEnv = Record<string, LanguageEnvEntry>

// ============ 持久化存储 ============

const store = createScopedStore('language-env')

// ============ 公共 API ============

/**
 * 获取指定工作区、指定语言的环境配置
 */
export function getLanguageEnv(workspacePath: string, languageId: string): LanguageEnvEntry | null {
  const key = normalizeKey(workspacePath)
  const workspaces = getWorkspaceConfigs()
  const matchingKey = Object.keys(workspaces)
    .filter(candidate => key === candidate || key.startsWith(`${candidate}/`))
    .sort((a, b) => b.length - a.length)[0]
  const workspaceConfig = matchingKey ? workspaces[matchingKey] : undefined
  return workspaceConfig?.[languageId] || null
}

/**
 * 设置指定工作区、指定语言的环境配置
 */
export function setLanguageEnv(workspacePath: string, languageId: string, entry: LanguageEnvEntry): void {
  const key = normalizeKey(workspacePath)
  const workspaces = getWorkspaceConfigs()
  const workspaceConfig = workspaces[key] || {}
  workspaceConfig[languageId] = entry
  workspaces[key] = workspaceConfig
  store.set('workspaces', workspaces)
  logger.lsp.info(`[LanguageEnv] Set ${languageId} env for ${workspacePath}:`, entry)
}

/**
 * 删除指定工作区、指定语言的环境配置
 */
export function removeLanguageEnv(workspacePath: string, languageId: string): void {
  const key = normalizeKey(workspacePath)
  const workspaces = getWorkspaceConfigs()
  const workspaceConfig = workspaces[key] || {}
  delete workspaceConfig[languageId]
  if (Object.keys(workspaceConfig).length === 0) {
    delete workspaces[key]
  } else {
    workspaces[key] = workspaceConfig
  }
  store.set('workspaces', workspaces)
}

/**
 * 获取指定工作区的所有语言环境配置
 */
export function getAllLanguageEnv(workspacePath: string): WorkspaceLanguageEnv {
  const key = normalizeKey(workspacePath)
  return getWorkspaceConfigs()[key] || {}
}

/**
 * 获取运行时路径（优先手动配置，回退到自动检测，最后系统默认）
 */
export function resolveRuntimePath(workspacePath: string, languageId: string): string {
  // 1. 手动配置优先
  const manual = getLanguageEnv(workspacePath, languageId)
  if (manual?.runtimePath) {
    const resolvedManual = resolveExecutable(manual.runtimePath)
    if (resolvedManual) return resolvedManual
    logger.lsp.warn(`[LanguageEnv] Configured ${languageId} runtime no longer exists: ${manual.runtimePath}`)
  }

  // 2. 自动检测
  const detected = autoDetectRuntime(workspacePath, languageId)
  if (detected) {
    return detected
  }

  // 3. 系统默认
  return getSystemDefault(languageId)
}

// ============ 自动检测逻辑 ============

function autoDetectRuntime(workspacePath: string, languageId: string): string | null {
  switch (languageId) {
    case 'python': return detectPythonRuntime(workspacePath)
    case 'go': return detectGoRuntime(workspacePath)
    case 'rust': return detectRustRuntime(workspacePath)
    case 'java': return detectJavaRuntime()
    default: return null
  }
}

function detectJavaRuntime(): string | null {
  const executable = process.platform === 'win32' ? 'java.exe' : 'java'
  const javaHome = process.env.JAVA_HOME
  if (javaHome) {
    const javaPath = path.join(javaHome, 'bin', executable)
    if (fs.existsSync(javaPath)) return javaPath
  }
  return resolveExecutable('java')
}

function detectPythonRuntime(workspacePath: string): string | null {
  const isWin = process.platform === 'win32'
  const pythonBin = isWin ? 'python.exe' : 'python3'
  const binDir = isWin ? 'Scripts' : 'bin'

  // 检查常见虚拟环境目录
  const venvDirs = ['.venv', 'venv', '.env', 'env', '.virtualenv', 'virtualenv']
  for (const dir of venvDirs) {
    const venvPython = path.join(workspacePath, dir, binDir, pythonBin)
    if (fs.existsSync(venvPython)) return venvPython
    if (isWin) {
      const alt = path.join(workspacePath, dir, 'Scripts', 'python.exe')
      if (fs.existsSync(alt)) return alt
    }
  }

  // 检查 VIRTUAL_ENV 环境变量
  const virtualEnv = process.env.VIRTUAL_ENV
  if (virtualEnv) {
    const envPython = path.join(virtualEnv, binDir, pythonBin)
    if (fs.existsSync(envPython)) return envPython
  }

  // 检查 pyrightconfig.json
  try {
    const configPath = path.join(workspacePath, 'pyrightconfig.json')
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      if (config.pythonPath) {
        const resolved = path.isAbsolute(config.pythonPath)
          ? config.pythonPath
          : path.resolve(workspacePath, config.pythonPath)
        if (fs.existsSync(resolved)) return resolved
      }
      if (config.venvPath && config.venv) {
        const venvBase = path.isAbsolute(config.venvPath)
          ? config.venvPath
          : path.resolve(workspacePath, config.venvPath)
        const venvPython = path.join(venvBase, config.venv, binDir, pythonBin)
        if (fs.existsSync(venvPython)) return venvPython
      }
    }
  } catch { /* ignore */ }

  // 检查 .python-version (pyenv)
  try {
    const pyVersionFile = path.join(workspacePath, '.python-version')
    if (fs.existsSync(pyVersionFile)) {
      const pyenvRoot = process.env.PYENV_ROOT || path.join(homedir(), '.pyenv')
      const version = fs.readFileSync(pyVersionFile, 'utf-8').trim()
      const pyenvPython = path.join(pyenvRoot, 'versions', version, binDir, pythonBin)
      if (fs.existsSync(pyenvPython)) return pyenvPython
    }
  } catch { /* ignore */ }

  // 检查 conda 环境
  try {
    const condaEnv = process.env.CONDA_PREFIX
    if (condaEnv) {
      const condaPython = path.join(condaEnv, isWin ? 'python.exe' : path.join('bin', 'python3'))
      if (fs.existsSync(condaPython)) return condaPython
    }
  } catch { /* ignore */ }

  return null
}

function detectGoRuntime(workspacePath: string): string | null {
  // 检查项目级 go 工具链（go.env 或 GOROOT 指定）
  try {
    const goEnvFile = path.join(workspacePath, 'go.env')
    if (fs.existsSync(goEnvFile)) {
      const content = fs.readFileSync(goEnvFile, 'utf-8')
      const match = content.match(/^GOROOT=(.+)$/m)
      if (match) {
        const goBin = path.join(match[1].trim(), 'bin', process.platform === 'win32' ? 'go.exe' : 'go')
        if (fs.existsSync(goBin)) return goBin
      }
    }
  } catch { /* ignore */ }

  // 检查 GOROOT 环境变量
  const goroot = process.env.GOROOT
  if (goroot) {
    const goBin = path.join(goroot, 'bin', process.platform === 'win32' ? 'go.exe' : 'go')
    if (fs.existsSync(goBin)) return goBin
  }
  return null
}

function detectRustRuntime(workspacePath: string): string | null {
  // 检查 rust-toolchain.toml 或 rust-toolchain
  try {
    const toolchainFile = path.join(workspacePath, 'rust-toolchain.toml')
    const toolchainFileLegacy = path.join(workspacePath, 'rust-toolchain')
    if (fs.existsSync(toolchainFile) || fs.existsSync(toolchainFileLegacy)) {
      // rustup 会自动处理 toolchain 选择，返回 null 让系统默认处理
      return null
    }
  } catch { /* ignore */ }
  return null
}

// ============ 系统默认值 ============

function getSystemDefault(languageId: string): string {
  const isWin = process.platform === 'win32'
  switch (languageId) {
    case 'python': return resolveExecutable(isWin ? 'python' : 'python3') || (isWin ? 'python' : 'python3')
    case 'go': return resolveExecutable('go') || 'go'
    case 'rust': return resolveExecutable('rustc') || 'rustc'
    case 'java': return detectJavaRuntime() || 'java'
    case 'cpp':
    case 'c': return isWin ? 'cl' : 'gcc'
    default: return languageId
  }
}

function resolveExecutable(command: string): string | null {
  if (path.isAbsolute(command)) return fs.existsSync(command) ? path.resolve(command) : null

  const searchDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  const extensions = process.platform === 'win32'
    ? ['', ...(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').map(ext => ext.toLowerCase())]
    : ['']

  for (const dir of searchDirs) {
    for (const extension of extensions) {
      const candidateName = extension && !command.toLowerCase().endsWith(extension) ? `${command}${extension}` : command
      const candidate = path.join(dir, candidateName)
      if (fs.existsSync(candidate)) return path.resolve(candidate)
    }
  }
  return null
}

// ============ 内部工具 ============

function normalizeKey(workspacePath: string): string {
  return workspacePath.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
}

function getWorkspaceConfigs(): Record<string, WorkspaceLanguageEnv> {
  return (store.get('workspaces') as Record<string, WorkspaceLanguageEnv> | undefined) || {}
}
