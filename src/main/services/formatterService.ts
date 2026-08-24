import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import type { FormatDocumentResult } from '@shared/types/formatter'

const WEB_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts',
  '.json', '.jsonc', '.css', '.scss', '.less', '.html', '.htm',
  '.md', '.mdx', '.yaml', '.yml', '.graphql', '.gql', '.vue', '.svelte', '.astro',
])
const BIOME_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts',
  '.json', '.jsonc', '.css', '.graphql', '.gql',
])
const CLANG_EXTENSIONS = new Set([
  '.c', '.h', '.cc', '.cpp', '.cxx', '.hh', '.hpp', '.hxx', '.m', '.mm', '.proto', '.java',
])

const BIOME_CONFIGS = ['biome.json', 'biome.jsonc']
const PRETTIER_CONFIGS = [
  '.prettierrc', '.prettierrc.json', '.prettierrc.json5', '.prettierrc.yaml', '.prettierrc.yml',
  '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.mjs', '.prettierrc.ts',
  'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs', 'prettier.config.ts',
]

export interface FormatterCommand {
  name: string
  command: string
  args: string[]
  cwd: string
}

function isInsideRoot(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function ancestors(start: string, root: string): string[] {
  const result: string[] = []
  let current = path.resolve(start)
  const boundary = path.resolve(root)
  while (isInsideRoot(current, boundary)) {
    result.push(current)
    if (current === boundary) break
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return result
}

function hasAnyConfig(directories: string[], names: string[]): boolean {
  return directories.some(directory => names.some(name => fs.existsSync(path.join(directory, name))))
}

function packageDeclaresFormatter(directories: string[], packageName: string): boolean {
  for (const directory of directories) {
    const packagePath = path.join(directory, 'package.json')
    try {
      const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf-8')) as Record<string, any>
      if (packageName === 'prettier' && parsed.prettier) return true
      if (parsed.dependencies?.[packageName] || parsed.devDependencies?.[packageName]) return true
    } catch {
      // A malformed package.json is not formatter configuration.
    }
  }
  return false
}

function findNodeTool(directories: string[], relativePath: string): string | null {
  for (const directory of directories) {
    const candidate = path.join(directory, 'node_modules', ...relativePath.split('/'))
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

function executableNames(name: string): string[] {
  if (process.platform !== 'win32') return [name]
  const extensions = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
  return extensions.map(extension => `${name}${extension.toLowerCase()}`)
}

function findOnPath(name: string): string | null {
  const entries = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  for (const directory of entries) {
    for (const executable of executableNames(name)) {
      const candidate = path.join(directory, executable)
      try {
        if (fs.statSync(candidate).isFile()) return candidate
      } catch {
        // Continue searching PATH.
      }
    }
  }
  return null
}

function findPythonTool(directories: string[], name: string): string | null {
  const relative = process.platform === 'win32' ? ['Scripts', `${name}.exe`] : ['bin', name]
  for (const directory of directories) {
    for (const environment of ['.venv', 'venv']) {
      const candidate = path.join(directory, environment, ...relative)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return findOnPath(name)
}

function nativeCommand(name: string, args: string[], cwd: string): FormatterCommand | null {
  const command = findOnPath(name)
  return command ? { name, command, args, cwd } : null
}

function rustEdition(directories: string[]): string | null {
  for (const directory of directories) {
    try {
      const cargo = fs.readFileSync(path.join(directory, 'Cargo.toml'), 'utf-8')
      const match = cargo.match(/^\s*edition\s*=\s*["'](2015|2018|2021|2024)["']/m)
      if (match) return match[1]
    } catch {
      // Continue towards the workspace root.
    }
  }
  return null
}

export function resolveFormatterCommand(filePath: string, workspaceRoot: string): FormatterCommand | null {
  if (!isInsideRoot(filePath, workspaceRoot)) return null
  const extension = path.extname(filePath).toLowerCase()
  const directories = ancestors(path.dirname(filePath), workspaceRoot)

  if (BIOME_EXTENSIONS.has(extension) && hasAnyConfig(directories, BIOME_CONFIGS)) {
    const biome = findNodeTool(directories, '@biomejs/biome/bin/biome')
    if (biome) {
      return {
        name: 'Biome',
        command: process.execPath,
        args: [biome, 'format', '--stdin-file-path', filePath],
        cwd: workspaceRoot,
      }
    }
  }

  if (WEB_EXTENSIONS.has(extension) && (hasAnyConfig(directories, PRETTIER_CONFIGS) || packageDeclaresFormatter(directories, 'prettier'))) {
    const prettier = findNodeTool(directories, 'prettier/bin/prettier.cjs')
      || findNodeTool(directories, 'prettier/bin-prettier.js')
    if (prettier) {
      return {
        name: 'Prettier',
        command: process.execPath,
        args: [prettier, '--stdin-filepath', filePath],
        cwd: workspaceRoot,
      }
    }
  }

  if (extension === '.py' || extension === '.pyi') {
    const ruff = findPythonTool(directories, 'ruff')
    if (ruff) return { name: 'Ruff', command: ruff, args: ['format', '--stdin-filename', filePath, '-'], cwd: workspaceRoot }
    const black = findPythonTool(directories, 'black')
    if (black) return { name: 'Black', command: black, args: ['--quiet', '--stdin-filename', filePath, '-'], cwd: workspaceRoot }
  }

  if (extension === '.go') return nativeCommand('gofmt', [], workspaceRoot)
  if (extension === '.rs') {
    const edition = rustEdition(directories)
    return nativeCommand('rustfmt', ['--emit', 'stdout', ...(edition ? ['--edition', edition] : [])], workspaceRoot)
  }
  if (CLANG_EXTENSIONS.has(extension) && hasAnyConfig(directories, ['.clang-format', '_clang-format'])) {
    return nativeCommand('clang-format', ['--assume-filename', filePath], workspaceRoot)
  }
  if (extension === '.sh' || extension === '.bash' || extension === '.zsh') return nativeCommand('shfmt', [], workspaceRoot)
  if (extension === '.lua') {
    const stylua = findOnPath('stylua')
    if (stylua) return { name: 'StyLua', command: stylua, args: ['--stdin-filepath', filePath, '-'], cwd: workspaceRoot }
  }

  return null
}

export async function formatWithProjectTool(
  filePath: string,
  content: string,
  workspaceRoot: string,
): Promise<FormatDocumentResult> {
  const formatter = resolveFormatterCommand(filePath, workspaceRoot)
  if (!formatter) return { status: 'unavailable' }

  return new Promise(resolve => {
    const formatterEnv = Object.fromEntries([
      'PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'HOME', 'USERPROFILE', 'TMP', 'TEMP', 'TMPDIR', 'LANG',
    ].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key] as string]]))
    const child = spawn(formatter.command, formatter.args, {
      cwd: formatter.cwd,
      env: { ...formatterEnv, NO_COLOR: '1', FORCE_COLOR: '0', ELECTRON_RUN_AS_NODE: '1' },
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let outputBytes = 0
    let errorBytes = 0
    let settled = false

    const finish = (result: FormatDocumentResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(result)
    }

    const timeout = setTimeout(() => {
      child.kill()
      finish({ status: 'error', formatter: formatter.name, message: `${formatter.name} timed out after 10 seconds` })
    }, 10_000)

    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length
      if (outputBytes > 20 * 1024 * 1024) {
        child.kill()
        finish({ status: 'error', formatter: formatter.name, message: `${formatter.name} produced too much output` })
        return
      }
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (errorBytes >= 64 * 1024) return
      stderr.push(chunk)
      errorBytes += chunk.length
    })
    child.on('error', error => finish({ status: 'error', formatter: formatter.name, message: error.message }))
    child.on('close', code => {
      if (code === 0) {
        finish({ status: 'formatted', formatter: formatter.name, content: Buffer.concat(stdout).toString('utf-8') })
      } else {
        const message = Buffer.concat(stderr).toString('utf-8').trim() || `${formatter.name} exited with code ${code}`
        finish({ status: 'error', formatter: formatter.name, message })
      }
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(content)
  })
}
