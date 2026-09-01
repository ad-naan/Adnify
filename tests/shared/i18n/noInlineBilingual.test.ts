/**
 * 内联双语文案的棘轮（ratchet）。
 *
 * 项目里曾经有 1300+ 处 `language === 'zh' ? '中文' : 'English'`，同一句话散在多个文件、
 * 加语言等于全项目搜索替换。清理之后剩下的都记在下面这份清单里：它们本身就不是文案 ——
 * 语言代码、数组下标、`pickLocalizedText` 这类按语言选数据结构的分支。
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
  // ---- 不是文案：语言本身的收敛点，加注释里引用的反例（正是这条测试要禁的写法）----
  'src/shared/i18n/index.ts': 5,
  'src/shared/config/changelogData.ts': 1,
  'src/renderer/agent/orchestration/laneNoticeText.ts': 1,

  // ---- 整段对象或数组是双语的（`? { … } : { … }`、`? 0 : 1` 下标、`? 'zh' : 'en'`
  //      语言代码），要先改数据结构才能进 locale ----
  'src/renderer/components/agent/ChatMessage.tsx': 1,
  'src/renderer/components/agent/ChatPanel.tsx': 1,
  'src/renderer/components/layout/FileFormatControls.tsx': 2,
  'src/renderer/components/layout/SkinPanel.tsx': 2,
  'src/renderer/components/mascot/MascotIP.tsx': 1,
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
  'src/renderer/components/settings/tabs/SystemSettings.tsx': 1,
  'src/renderer/components/sidebar/panels/ProblemsView.tsx': 1,
  'src/renderer/components/welcome/poster/workPosterData.ts': 1,
  'src/renderer/components/welcome/poster/workPosterRenderer.ts': 1,
  'src/renderer/hooks/useFileSave.ts': 1,
  'src/renderer/services/lspProviders.ts': 1,
  'src/renderer/shell/components/RemoteFileBrowser.tsx': 3,
  'src/renderer/shell/components/ShellStudio.tsx': 1,
}

/**
 * 五种写法都要认（每一种都漏过一次）：
 * - `isZh ? …` / `isEn ? …`（先存布尔再用，codemod 漏掉的就是这一类）
 * - `language === 'zh' ? …`（单双引号都算）
 * - `language !== 'en' ? …`（反着写的同一件事）
 * - 上面两条把 zh/en 互换：原生菜单整段是 `const isEn = …` + `isEn ? 'File' : '文件'`，
 *   只匹配 zh 的旧正则从来没看见过它。
 * - 布尔干脆就叫 `zh`：`const zh = language === 'zh'` + `zh ? '拒绝' : 'Reject'`。
 *   工具审批按钮、子代理进度、线程引用整片都是这么写的，`isZh` 正则一个都没抓到。
 *
 * 裸名 `zh`/`en` 只在后面紧跟三元 `?` 时才算，所以 `zh?.text`（可选链）、`zh?: string`
 * （可选属性）、`zh ?? en`（空值合并）不会被误判；左边的 `(?<![.\w])` 排掉 `entry.zh ? …`
 * 这种"按语言取数据字段"的正当写法。
 */
const PATTERN = /(?<![.\w])(isZh|isChinese|isEn|isEnglish|zh|en)\s*\?(?![.:?])|(language|lang|locale)\s*(===|!==)\s*['"](zh|en)['"]\s*\?/g

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

  it('never puts a dead fallback after t()', () => {
    // `t('copy', language) || '复制'`：t() 找不到键时返回键名本身，键名是真值，所以
    // `||` 右边永远不执行 —— 它唯一的作用是让"这里其实没接进 locale 表"看起来已经处理过了。
    // 真缺键时用户看到的是 `copy` 这种小写键名，兜底一个字也救不回来。
    const DEAD_FALLBACK = /\bt\(\s*['"][^'"]+['"][^)]*\)\s*\|\|\s*['"`]/g
    const offenders: Record<string, number> = {}
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec|property)\.tsx?$/.test(entry.name)) {
          const count = (fs.readFileSync(full, 'utf8').match(DEAD_FALLBACK) ?? []).length
          if (count > 0) offenders[path.relative(REPO_ROOT, full).split(path.sep).join('/')] = count
        }
      }
    }
    for (const root of ROOTS) walk(path.join(REPO_ROOT, root))
    expect(offenders).toEqual({})
  })
})
