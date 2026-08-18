/**
 * 项目规则服务
 * 支持 .adnify/rules.md 或 .cursorrules 文件
 * 让用户定义项目级 AI 行为偏好
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useStore } from '@store'
import { joinPath } from '@shared/utils/pathUtils'

export interface ProjectRules {
  content: string
  source: string
  lastModified: number
}

class RulesService {
  private cachedRules: ProjectRules | null = null
  private lastCheckTime = 0
  private checkInterval = 5000

  // 支持的规则文件名（按优先级从高到低探测，命中首个有效规则）
  private ruleFiles = [
    '.adnify/rules.md',
    '.adnifyrules',
    'CLAUDE.md',
    '.claude/CLAUDE.md',
    '.claude/rules.md',
    '.clauderules',
    '.cursorrules',
    '.cursor/rules.md',
    '.codexrules',
    '.codex/rules.md',
    '.codex/instructions.md',
    '.github/copilot-instructions.md',
    'CODING_GUIDELINES.md',
  ]

  /**
   * 获取项目规则
   */
  async getRules(forceRefresh = false): Promise<ProjectRules | null> {
    const { workspacePath } = useStore.getState()
    if (!workspacePath) return null

    const now = Date.now()
    
    if (!forceRefresh && this.cachedRules && (now - this.lastCheckTime) < this.checkInterval) {
      return this.cachedRules
    }

    this.lastCheckTime = now

    for (const ruleFile of this.ruleFiles) {
      const fullPath = joinPath(workspacePath, ruleFile)
      const content = await api.file.read(fullPath)
      
      if (content !== null) {
        this.cachedRules = {
          content: content.trim(),
          source: ruleFile,
          lastModified: now,
        }
        logger.agent.info(`[RulesService] Loaded rules from: ${ruleFile}`)
        return this.cachedRules
      }
    }

    this.cachedRules = null
    return null
  }

  /**
   * 保存规则到文件
   */
  async saveRules(content: string): Promise<boolean> {
    const { workspacePath } = useStore.getState()
    if (!workspacePath) return false

    // 确保 .adnify 目录存在
    const adnifyDir = joinPath(workspacePath, '.adnify')
    await api.file.mkdir(adnifyDir)

    const rulesPath = joinPath(workspacePath, '.adnify/rules.md')
    const success = await api.file.write(rulesPath, content)
    
    if (success) {
      this.cachedRules = {
        content: content.trim(),
        source: '.adnify/rules.md',
        lastModified: Date.now(),
      }
    }

    return success
  }

  /**
   * 获取默认规则模板
   */
  getDefaultRulesTemplate(): string {
    return `# Project Rules

## Code Style
- Use TypeScript for all new files
- Prefer functional components with hooks
- Use meaningful variable names

## Conventions
- Use async/await over .then()
- Prefer const over let

## Project Structure
- Components: src/components/
- Utilities: src/utils/
- Types: src/types/
`
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cachedRules = null
    this.lastCheckTime = 0
  }
}

export const rulesService = new RulesService()
