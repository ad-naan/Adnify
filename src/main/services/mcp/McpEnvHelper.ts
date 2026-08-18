/**
 * MCP 环境变量与命令行辅助工具
 * 提供跨平台 PATH 补全、环境规范化与错误诊断提取
 */

import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'

/**
 * 构造增强的系统环境变量，确保常见包管理器与运行环境可被正常解析
 */
export function getAugmentedProcessEnv(customEnv?: Record<string, string>): Record<string, string> {
  const homeDir = os.homedir()
  const platform = process.platform

  // 基础环境变量
  const baseEnv: Record<string, string> = {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    FORCE_COLOR: '0',
    ...(customEnv || {}),
  } as Record<string, string>

  // 待补充的常用 PATH 路径
  const candidatePaths: string[] = []

  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming')
    const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local')

    candidatePaths.push(
      path.join(homeDir, '.local', 'bin'),                  // uv / uvx / pipx 默认路径
      path.join(homeDir, '.cargo', 'bin'),                  // cargo 默认路径
      path.join(appData, 'npm'),                            // npm 全局全局路径
      path.join(appData, 'pnpm'),                           // pnpm 全局路径
      path.join(homeDir, '.bun', 'bin'),                    // bun 路径
      path.join(localAppData, 'Programs', 'Python', 'Python313'),
      path.join(localAppData, 'Programs', 'Python', 'Python313', 'Scripts'),
      path.join(localAppData, 'Programs', 'Python', 'Python312'),
      path.join(localAppData, 'Programs', 'Python', 'Python312', 'Scripts'),
      path.join(localAppData, 'Programs', 'Python', 'Python311'),
      path.join(localAppData, 'Programs', 'Python', 'Python311', 'Scripts'),
      'C:\\Program Files\\Docker\\Docker\\resources\\bin',
      'C:\\Program Files\\Git\\cmd',
      'C:\\Program Files\\nodejs'
    )
  } else {
    candidatePaths.push(
      path.join(homeDir, '.local', 'bin'),
      path.join(homeDir, '.cargo', 'bin'),
      path.join(homeDir, '.bun', 'bin'),
      path.join(homeDir, '.nvm', 'versions', 'node', 'current', 'bin'),
      '/usr/local/bin',
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/bin',
      '/bin'
    )
  }

  // 拼接 PATH
  const existingPath = baseEnv.PATH || baseEnv.Path || ''
  const pathDelimiter = platform === 'win32' ? ';' : ':'
  const existingPathSet = new Set(existingPath.split(pathDelimiter).filter(Boolean).map(p => p.toLowerCase()))

  const validNewPaths: string[] = []
  for (const candidate of candidatePaths) {
    if (candidate && !existingPathSet.has(candidate.toLowerCase()) && fs.existsSync(candidate)) {
      validNewPaths.push(candidate)
      existingPathSet.add(candidate.toLowerCase())
    }
  }

  if (validNewPaths.length > 0) {
    const combinedPath = [...validNewPaths, existingPath].filter(Boolean).join(pathDelimiter)
    baseEnv.PATH = combinedPath
    if (platform === 'win32') {
      baseEnv.Path = combinedPath
    }
  }

  return baseEnv
}

/**
 * 规范化不同 MCP 运行器的命令行参数
 */
export function normalizeLocalCommandArgs(command: string, args: string[]): string[] {
  if (!args || args.length === 0) return []

  const cmd = command.toLowerCase()

  // 1. uvx 规范化
  if (cmd === 'uvx') {
    const runtimeFlags: string[] = []
    const packageArgs: string[] = []

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg === '-p' || arg === '--python' || arg === '--from' || arg === '--with') {
        runtimeFlags.push(arg)
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          runtimeFlags.push(args[++i])
        }
      } else {
        packageArgs.push(arg)
      }
    }

    return [...runtimeFlags, ...packageArgs]
  }

  // 2. npx 规范化（确保带 -y 防止交互式卡死）
  if (cmd === 'npx' || cmd === 'bunx') {
    const hasY = args.includes('-y') || args.includes('--yes')
    if (!hasY) {
      return ['-y', ...args]
    }
    return args
  }

  // 3. docker 规范化
  if (cmd === 'docker') {
    if (args[0] === 'run') {
      const hasInteractive = args.includes('-i') || args.includes('-it')
      const hasRm = args.includes('--rm')
      const extraFlags: string[] = []
      if (!hasInteractive) extraFlags.push('-i')
      if (!hasRm) extraFlags.push('--rm')
      return [args[0], ...extraFlags, ...args.slice(1)]
    }
    return args
  }

  return args
}

/**
 * 从子进程 stderr 输出中提炼关键错误原因
 */
export function extractImportantStderr(stderr: string): string | null {
  if (!stderr) return null
  const lines = stderr.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return null

  // 过滤常见的正常下载或构建进度日志
  const progressKeywords = ['downloading', 'downloaded', 'building', 'built', 'installed', 'fetching']
  const errorLines = lines.filter(line => {
    const lower = line.toLowerCase()
    return !progressKeywords.some(kw => lower.startsWith(kw) || lower.includes(`(${kw})`))
  })

  if (errorLines.length > 0) {
    // 优先返回包含 Error / failed / exception 的行
    const matched = errorLines.filter(l => /error|fail|exception|denied|cannot/i.test(l))
    if (matched.length > 0) {
      return matched.slice(-3).join('; ')
    }
    return errorLines.slice(-2).join('; ')
  }

  return lines.slice(-1)[0] || null
}
