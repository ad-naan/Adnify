import { api } from './electronAPI'
import { gitService } from './gitService'
import { normalizePath, toRelativePath } from '@shared/utils/pathUtils'

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

interface GitExcludeStatus {
  pattern: string
  ignored: boolean
  available: boolean
}

async function findRepositoryForPath(workspacePath: string, targetPath: string) {
  const repositories = await gitService.discoverRepositories(workspacePath, 3, true)
  return repositories
    .filter(repo => targetPath === repo.root || targetPath.startsWith(`${repo.root}/`))
    .sort((left, right) => right.root.length - left.root.length)[0]
}

class GitExcludeService {
  async update(
    workspacePath: string,
    targetPath: string,
    isDirectory: boolean,
    action: 'add' | 'remove',
  ): Promise<{ changed: boolean; pattern: string }> {
    const normalizedTarget = normalizePath(targetPath).replace(/\/$/, '')
    const repository = await findRepositoryForPath(workspacePath, normalizedTarget)
    if (!repository) throw new Error('所选内容不在 Git 仓库中')

    const pattern = createGitExcludePattern(repository.root, targetPath, isDirectory)
    const ignorePath = `${repository.root}/.gitignore`
    const exists = await api.file.exists(ignorePath)
    const current = exists ? (await api.file.read(ignorePath) || '') : ''
    const next = updateGitExcludeContent(current, pattern, action)
    if (next === current) return { changed: false, pattern }

    const written = await api.file.write(ignorePath, next)
    if (!written) throw new Error('写入 .gitignore 失败')
    return { changed: true, pattern }
  }

  async getStatus(
    workspacePath: string,
    targetPath: string,
    isDirectory: boolean,
  ): Promise<GitExcludeStatus> {
    const normalizedTarget = normalizePath(targetPath).replace(/\/$/, '')
    const repository = await findRepositoryForPath(workspacePath, normalizedTarget)
    if (!repository) return { pattern: '', ignored: false, available: false }

    const pattern = createGitExcludePattern(repository.root, targetPath, isDirectory)
    const ignorePath = `${repository.root}/.gitignore`
    const exists = await api.file.exists(ignorePath)
    const current = exists ? (await api.file.read(ignorePath) || '') : ''
    return {
      pattern,
      available: true,
      ignored: updateGitExcludeContent(current, pattern, 'remove') !== current,
    }
  }
}

export const gitExcludeService = new GitExcludeService()
