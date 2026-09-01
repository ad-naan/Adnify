/**
 * 内联双语文案的棘轮（ratchet）。
 *
 * 项目里曾经有 1300+ 处 `language === 'zh' ? '中文' : 'English'`，同一句话散在多个文件、
 * 加语言等于全项目搜索替换。批量迁移（scripts/i18n-codemod.mjs）之后剩下的都记在下面
 * 这份清单里：要么本身就不是文案（语言代码、数组下标），要么整段对象/数组是双语的，
 * 要么是 codemod 没覆盖到、等着后续清理的文件。
 *
 * 这个测试只做一件事：数量只允许变小。
 * - 新文件里再写内联三元 → 红，请改成 `t('key', asLanguage(language))`
 * - 清单里的文件被清理干净 → 也会红，把对应数字改小/删掉这一行即可
 *
 * 两个扫描范围上的坑（都是踩过的）：
 * 1. 只匹配 `language === 'zh' ?` 会漏掉 `const isZh = language === 'zh'` + `isZh ? …`
 *    这个惯用法 —— 命令面板、首次引导整个文件都是这么写的，测试却一直是绿的。
 * 2. 只扫 `src/renderer` 会漏掉主进程和 shared —— 安全审批弹窗的按钮文案就在
 *    `src/main/security/securityModule.ts` 里。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const REPO_ROOT = path.resolve(__dirname, '../../..')
const ROOTS = ['src/renderer', 'src/main', 'src/shared']

/** 文件（相对仓库根）→ 还允许存在的内联双语表达式数量 */
const BUDGET: Record<string, number> = {
  // ---- 不是文案：语言本身的收敛点 / pickLocalizedText / 注释里的反例 ----
  'src/renderer/i18n/index.ts': 1,
  'src/renderer/agent/utils/agentText.ts': 1,
  'src/renderer/agent/orchestration/laneNoticeText.ts': 1,

  // ---- 整段对象或数组是双语的（`? { … } : { … }`、`? 0 : 1` 下标、`? 'zh' : 'en'`
  //      语言代码），要先改数据结构才能进 locale ----
  'src/renderer/components/agent/ChatMessage.tsx': 1,
  'src/renderer/components/agent/ChatPanel.tsx': 1,
  'src/renderer/components/agent/TaskCommandCenter.tsx': 3,
  'src/renderer/components/layout/FileFormatControls.tsx': 2,
  'src/renderer/components/layout/SkinPanel.tsx': 2,
  'src/renderer/components/mascot/MascotIP.tsx': 1,
  'src/renderer/components/panels/ContextStatsContent.tsx': 1,
  'src/renderer/components/panels/ToolCallLogContent.tsx': 1,
  'src/renderer/components/plan/workbench/PlanHistoryDrawer.tsx': 1,
  'src/renderer/components/plan/workbench/PlanWorkbench.tsx': 2,
  'src/renderer/components/plan/workbench/PlanWorkbenchActivity.tsx': 1,
  'src/renderer/components/plan/workbench/PlanWorkbenchProcessing.tsx': 2,
  'src/renderer/components/settings/SettingsModal.tsx': 1,
  'src/renderer/components/settings/tabs/AgentSettings.tsx': 1,
  'src/renderer/components/settings/tabs/IndexSettings.tsx': 1,
  'src/renderer/components/settings/tabs/McpAddServerModal.tsx': 7,
  'src/renderer/components/settings/tabs/McpSettings.tsx': 2,
  'src/renderer/components/settings/tabs/PromptPreviewModal.tsx': 4,
  'src/renderer/components/settings/tabs/ProviderSettings.tsx': 1,
  'src/renderer/components/settings/tabs/SkillSettings.tsx': 1,
  'src/renderer/components/settings/tabs/SystemSettings.tsx': 1,
  'src/renderer/components/sidebar/panels/ProblemsView.tsx': 1,
  'src/renderer/components/welcome/UsageDashboard.tsx': 4,
  'src/renderer/components/welcome/poster/workPosterData.ts': 1,
  'src/renderer/components/welcome/poster/workPosterRenderer.ts': 1,
  'src/renderer/hooks/useFileSave.ts': 1,
  'src/renderer/services/lspProviders.ts': 1,
  'src/renderer/shell/components/RemoteFileBrowser.tsx': 3,
  'src/renderer/shell/components/ShellStudio.tsx': 1,

  // ---- 真·待清理：全部是用户能看到的文案，codemod 没覆盖到这批 `isZh` 写法。
  //      清理时把对应行数字改小或删掉整行。----
  'src/renderer/components/dialogs/CommandPalette.tsx': 66,
  'src/renderer/components/dialogs/OnboardingWizard.tsx': 61,
  'src/renderer/components/dialogs/UserAvatarDialog.tsx': 26,
  'src/renderer/components/agent/CompressionDigestCard.tsx': 15,
  'src/renderer/components/dialogs/AboutDialog.tsx': 14,
  'src/renderer/components/dialogs/ChangelogDialog.tsx': 14,
  'src/renderer/components/editor/TabContextMenu.tsx': 12,
  'src/renderer/components/welcome/poster/WorkPosterModal.tsx': 8,
  'src/shared/utils/dateUtils.ts': 7,
  'src/main/security/securityModule.ts': 4,
  'src/main/ipc/systemPrivilege.ts': 1,
  'src/main/services/window/ShutdownWindowController.ts': 1,
  'src/shared/config/mcpPresets.ts': 1,
}

/**
 * 三种写法都要认：
 * - `isZh ? …`（先存布尔再用，codemod 漏掉的就是这一类）
 * - `language === 'zh' ? …`（单双引号都算）
 * - `language !== 'en' ? …`（反着写的同一件事）
 */
const PATTERN = /\b(isZh|isChinese)\b\s*\?|(language|lang|locale)\s*===\s*['"]zh['"]\s*\?|(language|lang|locale)\s*!==\s*['"]en['"]\s*\?/g

function scan(dir: string, into: Record<string, number>): Record<string, number> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      scan(full, into)
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec|property)\.tsx?$/.test(entry.name)) {
      const count = (fs.readFileSync(full, 'utf8').match(PATTERN) ?? []).length
      if (count > 0) into[path.relative(REPO_ROOT, full).split(path.sep).join('/')] = count
    }
  }
  return into
}

describe('inline bilingual text', () => {
  it('only ever shrinks', () => {
    const found: Record<string, number> = {}
    for (const root of ROOTS) scan(path.join(REPO_ROOT, root), found)
    // toEqual 而不是"小于等于"：清单必须和现状完全一致，否则失败信息里看不出该改哪一行。
    expect(found).toEqual(BUDGET)
  })

  it('never lets a t() call site cast its key', () => {
    // `t('foo' as any, lang)` 绕过 TranslationKey 检查，键不存在时 t() 会把键名原样
    // 显示给用户（返回值是 key 本身，所以 `|| '兜底'` 也救不回来）。
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry.name) && /t\(\s*['"][^'"]+['"]\s+as\s+any/.test(fs.readFileSync(full, 'utf8'))) {
          offenders.push(path.relative(REPO_ROOT, full).split(path.sep).join('/'))
        }
      }
    }
    for (const root of ROOTS) walk(path.join(REPO_ROOT, root))
    expect(offenders).toEqual([])
  })
})
