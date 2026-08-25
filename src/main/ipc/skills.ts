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

  logger.ipc.info('[Skills IPC] Handlers registered')
}
