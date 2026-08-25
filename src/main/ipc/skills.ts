/**
 * Skills IPC 处理器
 * 提供全局 Skills 目录路径等功能
 */

import * as path from 'path'
import * as fs from 'fs'
import { safeIpcHandle } from './safeHandle'
import { logger } from '@shared/utils/Logger'
import { getUserConfigDir } from '../services/configPath'

import * as os from 'os'

function getGlobalSkillDirs(): string[] {
  const homeDir = os.homedir()
  return [
    path.join(homeDir, '.cursor', 'skills'),
    path.join(homeDir, '.codex', 'skills'),
    path.join(homeDir, '.claude', 'skills'),
    path.join(getUserConfigDir(), 'skills'),
  ]
}

function getExternalGlobalSkillDirs(): string[] {
  return getGlobalSkillDirs().slice(0, -1)
}

function getExternalProjectSkillDirs(workspacePath: string): string[] {
  return [
    path.join(workspacePath, 'skills'),
    path.join(workspacePath, '.cursor', 'skills'),
    path.join(workspacePath, '.codex', 'skills'),
    path.join(workspacePath, '.claude', 'skills'),
  ]
}

function resolveSkillProvider(skillDir: string): string {
  const normalized = skillDir.replace(/\\/g, '/').toLowerCase()
  if (normalized.includes('/.cursor/')) return 'cursor'
  if (normalized.includes('/.codex/')) return 'codex'
  if (normalized.includes('/.claude/')) return 'claude'
  return 'generic'
}

function isDirectChildOf(candidate: string, roots: string[]): boolean {
  const resolvedCandidate = path.resolve(candidate)
  return roots.some((root) => {
    const relative = path.relative(path.resolve(root), resolvedCandidate)
    return relative !== ''
      && relative !== '..'
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
      && !relative.includes(path.sep)
  })
}

export function registerSkillsHandlers(): void {
  // 获取 Adnify 默认全局 Skills 目录路径
  safeIpcHandle('skills:getGlobalDir', async () => {
    const dir = path.join(getUserConfigDir(), 'skills')
    await fs.promises.mkdir(dir, { recursive: true })
    return dir
  })

  // 获取所有全局候选 Skills 目录（按优先级从低到高：Cursor -> Codex -> Claude -> Adnify）
  safeIpcHandle('skills:getGlobalDirs', async () => {
    const adnifyDir = path.join(getUserConfigDir(), 'skills')
    await fs.promises.mkdir(adnifyDir, { recursive: true })
    return getGlobalSkillDirs()
  })

  // 仅允许删除已扫描全局 Skills 根目录中的一个直接子目录。
  safeIpcHandle('skills:deleteGlobalSkill', async (_, skillDir: string) => {
    const resolvedSkillDir = path.resolve(skillDir)
    const matchedRoot = getGlobalSkillDirs().find((root) => {
      const relative = path.relative(path.resolve(root), resolvedSkillDir)
      return relative !== ''
        && relative !== '..'
        && !relative.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relative)
        && !relative.includes(path.sep)
    })
    if (!matchedRoot) {
      logger.ipc.warn(`[Skills IPC] Refused to delete unknown global Skill path: ${skillDir}`)
      return false
    }

    if (!fs.existsSync(path.join(resolvedSkillDir, 'SKILL.md'))) return false
    await fs.promises.rm(resolvedSkillDir, { recursive: true, force: false })
    logger.ipc.info(`[Skills IPC] Deleted global Skill: ${resolvedSkillDir}`)
    return true
  })

  safeIpcHandle('skills:importExternalSkill', async (
    _,
    sourceSkillDir: string,
    level: 'global' | 'project',
    workspacePath?: string,
  ) => {
    const sourceRoots = [
      ...getExternalGlobalSkillDirs(),
      ...(workspacePath ? getExternalProjectSkillDirs(workspacePath) : []),
    ]
    if (!isDirectChildOf(sourceSkillDir, sourceRoots)) {
      return { success: false, error: 'Unknown external Skill source path' }
    }
    if (!fs.existsSync(path.join(sourceSkillDir, 'SKILL.md'))) {
      return { success: false, error: 'SKILL.md was not found' }
    }

    const targetRoot = level === 'global'
      ? path.join(getUserConfigDir(), 'skills')
      : workspacePath
        ? path.join(workspacePath, '.adnify', 'skills')
        : ''
    if (!targetRoot) return { success: false, error: 'Open a project before importing to the project scope' }

    const targetDir = path.join(targetRoot, path.basename(sourceSkillDir))
    if (fs.existsSync(targetDir)) return { success: false, error: 'A Skill with this folder name already exists in Adnify' }

    await fs.promises.mkdir(targetRoot, { recursive: true })
    await fs.promises.cp(sourceSkillDir, targetDir, { recursive: true, errorOnExist: true, force: false })
    await fs.promises.writeFile(path.join(targetDir, '.adnify-origin.json'), JSON.stringify({
      provider: resolveSkillProvider(sourceSkillDir),
      path: sourceSkillDir,
      importedAt: Date.now(),
    }, null, 2), 'utf-8')
    return { success: true, targetDir }
  })

  logger.ipc.info('[Skills IPC] Handlers registered')
}
