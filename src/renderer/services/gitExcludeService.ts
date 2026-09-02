import { api } from './electronAPI'
import { gitService } from './gitService'
import { normalizePath, toRelativePath } from '@shared/utils/pathUtils'
import { t, type Language } from '@shared/i18n'

export type GitIgnoreTarget = 'gitignore' | 'exclude'

/**
 * 服务自己不取语言，抛原因码；变成人话在调用点做（那里才有 `language`）——
 * 和 `securityReasonText.ts` 处理 `ExecutionReason` 是同一个形状。
 *
 * 这么写不只是为了对称：这个模块被 `tests/services/gitExcludeService.test.ts` 直接 import
 * 来测两个纯函数，它刻意只 mock 了 electronAPI 和 gitService。为了两句错误文案而
 * `import { useStore }`，会把整个 store 的模块图拖进那个测试，import 直接超时。
 */
export type GitIgnoreErrorCode = 'notInsideRepository' | 'writeFailed'

export class GitIgnoreError extends Error {
  constructor(readonly code: GitIgnoreErrorCode, readonly params?: Record<string, string>) {
    super(code)
    this.name = 'GitIgnoreError'
  }
}

/** `gitExcludeService.${code}` 是模板字面量类型，漏一个键编译期就报错。 */
export function gitIgnoreErrorText(error: unknown, language: Language): string {
  if (error instanceof GitIgnoreError) return t(`gitExcludeService.${error.code}`, language, error.params)
  return error instanceof Error ? error.message : String(error)
}

export function createGitExcludePattern(repoRoot: string, targetPath: string, isDirectory: boolean): string {
  const relative = toRelativePath(normalizePath(targetPath), normalizePath(repoRoot))
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
  const escaped = relative.replace(/([\\[\]*?!# ])/g, '\\$1')
  return `/${escaped}${isDirectory ? '/' : ''}`
}

export function updateGitExcludeContent(content: string, pattern: string, action: 'add' | 'remove'): string {
  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  const hasPattern = lines.some(line => line.trim() === pattern)
  if (action === 'add' && hasPattern) return content

  if (action === 'remove') {
    if (!hasPattern) return content
    const hadTrailingNewline = /\r?\n$/.test(content)
    const filtered = lines.filter(line => line.trim() !== pattern)
    while (filtered.length > 0 && filtered.at(-1) === '') filtered.pop()
    return filtered.join(newline) + (hadTrailingNewline && filtered.length > 0 ? newline : '')
  }

  while (lines.length > 0 && lines.at(-1) === '') lines.pop()
  lines.push(pattern, '')
  return lines.join(newline)
}

export interface GitIgnoreEntryStatus {
  pattern: string
  ignored: boolean
  available: boolean
}

export interface GitIgnoreCombinedStatus {
  available: boolean
  gitignore: GitIgnoreEntryStatus
  exclude: GitIgnoreEntryStatus
}

async function findRepositoryForPath(workspacePath: string, targetPath: string) {
  const repositories = await gitService.discoverRepositories(workspacePath, 3, true)
  return repositories
    .filter(repo => targetPath === repo.root || targetPath.startsWith(`${repo.root}/`))
    .sort((left, right) => right.root.length - left.root.length)[0]
}

async function resolveIgnoreFilePath(repoRoot: string, target: GitIgnoreTarget): Promise<string> {
  return target === 'gitignore'
    ? `${repoRoot}/.gitignore`
    : await gitService.getExcludeFilePath(repoRoot)
}

class GitExcludeService {
  async update(
    workspacePath: string,
    targetPath: string,
    isDirectory: boolean,
    action: 'add' | 'remove',
    target: GitIgnoreTarget = 'exclude',
  ): Promise<{ changed: boolean; pattern: string; target: GitIgnoreTarget }> {
    const normalizedTarget = normalizePath(targetPath).replace(/\/$/, '')
    const repository = await findRepositoryForPath(workspacePath, normalizedTarget)
    if (!repository) throw new GitIgnoreError('notInsideRepository')

    const pattern = createGitExcludePattern(repository.root, targetPath, isDirectory)
    const filePath = await resolveIgnoreFilePath(repository.root, target)
    const exists = await api.file.exists(filePath)
    const current = exists ? (await api.file.readFull(filePath) || '') : ''
    const next = updateGitExcludeContent(current, pattern, action)
    if (next === current) return { changed: false, pattern, target }

    const written = await api.file.write(filePath, next)
    const fileLabel = target === 'gitignore' ? '.gitignore' : '.git/info/exclude'
    if (!written) throw new GitIgnoreError('writeFailed', { file: fileLabel })
    return { changed: true, pattern, target }
  }

  async getStatus(
    workspacePath: string,
    targetPath: string,
    isDirectory: boolean,
  ): Promise<GitIgnoreCombinedStatus> {
    const normalizedTarget = normalizePath(targetPath).replace(/\/$/, '')
    const repository = await findRepositoryForPath(workspacePath, normalizedTarget)
    if (!repository) {
      return {
        available: false,
        gitignore: { pattern: '', ignored: false, available: false },
        exclude: { pattern: '', ignored: false, available: false },
      }
    }

    const pattern = createGitExcludePattern(repository.root, targetPath, isDirectory)
    const gitignorePath = await resolveIgnoreFilePath(repository.root, 'gitignore')
    const excludePath = await resolveIgnoreFilePath(repository.root, 'exclude')

    const [gitignoreExists, excludeExists] = await Promise.all([
      api.file.exists(gitignorePath),
      api.file.exists(excludePath),
    ])

    const [gitignoreContent, excludeContent] = await Promise.all([
      gitignoreExists ? (await api.file.readFull(gitignorePath) || '') : '',
      excludeExists ? (await api.file.readFull(excludePath) || '') : '',
    ])

    return {
      available: true,
      gitignore: {
        pattern,
        available: true,
        ignored: updateGitExcludeContent(gitignoreContent, pattern, 'remove') !== gitignoreContent,
      },
      exclude: {
        pattern,
        available: true,
        ignored: updateGitExcludeContent(excludeContent, pattern, 'remove') !== excludeContent,
      },
    }
  }
}

export const gitExcludeService = new GitExcludeService()
