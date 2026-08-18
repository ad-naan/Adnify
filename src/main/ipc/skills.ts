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

export function registerSkillsHandlers(): void {
  // 获取 Adnify 默认全局 Skills 目录路径
  safeIpcHandle('skills:getGlobalDir', async () => {
    const dir = path.join(getUserConfigDir(), 'skills')
    await fs.promises.mkdir(dir, { recursive: true })
    return dir
  })

  // 获取所有全局候选 Skills 目录（按优先级从低到高：Cursor -> Codex -> Claude -> Adnify）
  safeIpcHandle('skills:getGlobalDirs', async () => {
    const homeDir = os.homedir()
    const adnifyDir = path.join(getUserConfigDir(), 'skills')
    await fs.promises.mkdir(adnifyDir, { recursive: true })

    const candidateDirs = [
      path.join(homeDir, '.cursor', 'skills'),
      path.join(homeDir, '.codex', 'skills'),
      path.join(homeDir, '.claude', 'skills'),
      adnifyDir,
    ]

    return candidateDirs
  })

  logger.ipc.info('[Skills IPC] Handlers registered')
}
