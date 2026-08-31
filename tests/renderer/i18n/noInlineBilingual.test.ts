/**
 * 内联双语文案的棘轮（ratchet）。
 *
 * 项目里曾经有 1300+ 处 `language === 'zh' ? '中文' : 'English'`，同一句话散在多个文件、
 * 加语言等于全项目搜索替换。批量迁移（scripts/i18n-codemod.mjs）之后只剩下面这份清单里
 * 的少数几处，它们要么本身就不是文案（语言代码、数组下标），要么文案来自数据/模型输出，
 * 没法进 locale 文件。
 *
 * 这个测试只做一件事：数量只允许变小。
 * - 新文件里再写内联三元 → 红，请改成 `t('key', asLanguage(language))`
 * - 清单里的文件被清理干净 → 也会红，把对应数字改小/删掉这一行即可
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RENDERER = path.resolve(__dirname, '../../../src/renderer')

/** 文件（相对 src/renderer） → 还允许存在的内联双语表达式数量 */
const BUDGET: Record<string, number> = {
  // 语言本身的收敛点 / 给 agent 侧用的 pickLocalizedText / 注释里举的反例，都不是文案
  'i18n/index.ts': 1,
  'agent/utils/agentText.ts': 1,
  'agent/orchestration/laneNoticeText.ts': 1,
  // 整段对象或数组是双语的（`language === 'zh' ? { … } : { … }`、`? 0 : 1` 下标、
  // `? 'zh' : 'en'` 语言代码），要先改数据结构才能进 locale
  'components/agent/ChatMessage.tsx': 1,
  'components/agent/ChatPanel.tsx': 1,
  'components/agent/TaskCommandCenter.tsx': 3,
  'components/layout/FileFormatControls.tsx': 2,
  'components/layout/SkinPanel.tsx': 2,
  'components/mascot/MascotIP.tsx': 1,
  'components/panels/ContextStatsContent.tsx': 1,
  'components/panels/ToolCallLogContent.tsx': 1,
  'components/plan/workbench/PlanHistoryDrawer.tsx': 1,
  'components/plan/workbench/PlanWorkbench.tsx': 2,
  'components/plan/workbench/PlanWorkbenchActivity.tsx': 1,
  'components/plan/workbench/PlanWorkbenchProcessing.tsx': 2,
  'components/settings/SettingsModal.tsx': 1,
  'components/settings/tabs/AgentSettings.tsx': 1,
  'components/settings/tabs/IndexSettings.tsx': 1,
  'components/settings/tabs/McpAddServerModal.tsx': 7,
  'components/settings/tabs/McpSettings.tsx': 2,
  'components/settings/tabs/PromptPreviewModal.tsx': 4,
  'components/settings/tabs/ProviderSettings.tsx': 1,
  'components/settings/tabs/SkillSettings.tsx': 1,
  'components/settings/tabs/SystemSettings.tsx': 1,
  'components/sidebar/panels/ProblemsView.tsx': 1,
  'components/welcome/UsageDashboard.tsx': 4,
  'components/welcome/poster/workPosterData.ts': 1,
  'components/welcome/poster/workPosterRenderer.ts': 1,
  'hooks/useFileSave.ts': 1,
  'services/lspProviders.ts': 1,
  'shell/components/RemoteFileBrowser.tsx': 3,
  'shell/components/ShellStudio.tsx': 1,
}

const PATTERN = /(language|lang)\s*===\s*'zh'\s*\?/g

function scan(dir: string, into: Record<string, number>): Record<string, number> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      scan(full, into)
    } else if (/\.tsx?$/.test(entry.name)) {
      const count = (fs.readFileSync(full, 'utf8').match(PATTERN) ?? []).length
      if (count > 0) into[path.relative(RENDERER, full).split(path.sep).join('/')] = count
    }
  }
  return into
}

describe('inline bilingual text', () => {
  it('only ever shrinks', () => {
    // toEqual 而不是"小于等于"：清单必须和现状完全一致，否则失败信息里看不出该改哪一行。
    expect(scan(RENDERER, {})).toEqual(BUDGET)
  })
})
