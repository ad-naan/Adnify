/**
 * 内联双语文案的棘轮（ratchet）。
 *
 * 项目里曾经有 1300+ 处 `language === 'zh' ? '中文' : 'English'`，同一句话散在多个文件、
 * 加语言等于全项目搜索替换。清理之后剩下的都记在下面这份清单里：它们本身就不是文案 ——
 * 语言代码、数组下标、`pickLocalized` 这类按语言选数据结构的分支。
 *
 * 这个测试只做一件事：数量只允许变小。
 * - 新文件里再写内联三元 → 红，请改成 `t('key', asLanguage(language))`
 * - 清单里的文件被清理干净 → 也会红，把对应数字改小/删掉这一行即可
 *
 * **一句话文案能藏进代码的五种形态**，每一种都有自己的预算，因为每一种都躲过了前一种的正则：
 * 1. 三元 `language === 'zh' ? '中文' : 'English'`
 * 2. 本地文案表 `{ en: '…', zh: '…' }`
 * 3. 字段名带语言后缀 `description` / `descriptionZh`
 * 4. 双语元组 `['待审阅', 'Draft']`
 * 5. 只有中文、没有英文（英文界面下直接漏中文）
 *
 * 形态 3/4/5 是 2026-09-02 补的。补之前把 1、2 清零会得出"干净了"的结论，实际还有 160 处
 * 内联双语躺着 —— 形态 3 一个文件就 113 处，比形态 1 和 2 加起来还多。
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
  'src/shared/i18n/index.ts': 3,
  'src/shared/config/changelogData.ts': 1,
  'src/renderer/agent/orchestration/laneNoticeText.ts': 1,

  // ---- 整段对象或数组是双语的（`? { … } : { … }`、`? 0 : 1` 下标、`? 'zh' : 'en'`
  //      语言代码），要先改数据结构才能进 locale ----
  'src/renderer/components/settings/SettingsModal.tsx': 1,
  'src/renderer/components/settings/tabs/AgentSettings.tsx': 1,
  'src/renderer/components/settings/tabs/McpAddServerModal.tsx': 7,
  'src/renderer/components/settings/tabs/McpSettings.tsx': 1,
  'src/renderer/components/settings/tabs/PromptPreviewModal.tsx': 1,
  'src/renderer/components/welcome/poster/workPosterRenderer.ts': 1,
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

/** `scan` 的可选行为。默认都关着，形态 1 / 2 两条预算的语义不变。 */
interface ScanOptions {
  /** 先去掉注释再匹配。中文注释比中文文案多一个数量级，不去掉的话形态 5 那条守卫直接被淹掉。 */
  stripComments?: boolean
  /** 永久豁免的文件（相对仓库根）。和 `DATA_GATES` 一个意思：不是欠账，是正当例外。 */
  gates?: readonly string[]
}

/** `//` 行注释和块注释。`(^|[^:])` 是为了别把 `https://` 里的双斜杠当成注释起点。 */
const COMMENTS = /\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g

function scan(
  dir: string,
  pattern: RegExp,
  into: Record<string, number>,
  options: ScanOptions = {},
): Record<string, number> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      scan(full, pattern, into, options)
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec|property)\.tsx?$/.test(entry.name)) {
      const relative = path.relative(REPO_ROOT, full).split(path.sep).join('/')
      if (options.gates?.includes(relative)) continue
      let source = fs.readFileSync(full, 'utf8')
      if (options.stripComments) source = source.replace(COMMENTS, '$1')
      const count = (source.match(pattern) ?? []).length
      if (count > 0) into[relative] = count
    }
  }
  return into
}

describe('inline bilingual text', () => {
  it('only ever shrinks', () => {
    const found: Record<string, number> = {}
    for (const root of ROOTS) scan(path.join(REPO_ROOT, root), PATTERN, found)
    // toEqual 而不是"小于等于"：清单必须和现状完全一致，否则失败信息里看不出该改哪一行。
    expect(found).toEqual(BUDGET)
  })

  /**
   * 第二种内联双语，上面那条正则完全看不见：把 `{ en: '…', zh: '…' }` 文案表放在用它的文件里。
   *
   * LspSettings 里就有过一张 18 条的 —— `Record<string, Record<string, string>>` 加
   * `translations[key]?.[language] || key`，调用点写成 `tt('apply')`。看着和 `t('…')` 一样干净，
   * 但键只存在于那个组件里：locale 表少了这些词，加语言要改的是组件而不是语言包，翻译也没法
   * 跟着 localeParity 一起审。键写错时它兜底返回键名本身，和 t() 缺键是同一个坑（见下面两条）。
   *
   * 只认两个值都是字面量的成对写法，所以"按语言取数据字段"的正当写法不会被误判：
   * `pickLocalized({ zh, en: en ?? zh }, lang)` 的值是变量，类型声明 `{ en: string; zh: string }`
   * 没有引号。
   */
  it('never keeps a local {en, zh} copy table', () => {
    const COPY_TABLE = /\b(en|zh)\s*:\s*('[^']*'|"[^"]*"|`[^`]*`)\s*,\s*(zh|en)\s*:/g
    // `src/shared/i18n/index.ts` 里的 `LOCALE_TAGS = { en: 'en-US', zh: 'zh-CN' }` 形状上就是
    // 一张字面量双语表，内容却是 BCP-47 标签而不是文案 —— 而这个文件本来就是"按语言取值"的
    // 收敛点，加语言时要改的正是它。宁可在这里写一行豁免，也不为了躲自家正则把
    // `toLocaleTag` 退回成三元（那只是把同一件事挪进另一条守卫的账上）。
    const GATES = ['src/shared/i18n/index.ts']
    /** 文件（相对仓库根）→ 还允许存在的字面量双语对数量 */
    const COPY_TABLE_BUDGET: Record<string, number> = {
      // ---- 双语标签是数据表的一列：要先给每行定一个键，才谈得上搬进 locale ----
      'src/renderer/components/settings/settingsSearchIndex.ts': 71,
      'src/shared/config/mcpPresets.ts': 9,
    }
    const found: Record<string, number> = {}
    for (const root of ROOTS) scan(path.join(REPO_ROOT, root), COPY_TABLE, found, { gates: GATES })
    expect(found).toEqual(COPY_TABLE_BUDGET)
  })

  /**
   * 形态 3：把语言写进字段名 —— `description` / `descriptionZh` 这种"英文那半不带后缀"的成对字段。
   *
   * 量最大的一种（147 处），而前两条正则一处也看不见：它没有 `{ en, zh }` 字面量表的形状，
   * 读取点写成 `language === 'zh' ? p.descriptionZh : p.description` —— 那个三元在形态 1 里
   * 被归进"按语言取数据字段"的正当写法，于是整组文案就靠"文案在数据结构里"这个理由躲了过去。
   * 数据结构里也不行：加一种语言要改的是数据结构而不是语言包，翻译也跟不上 localeParity 的审。
   *
   * 只数带后缀的那一半，且值必须是字面量或数组 —— 所以 `descriptionZh: v.description`
   * （运行时从 registry 拿到的散文）和 `descriptionZh: string`（类型声明）不算。
   */
  it('never suffixes a field name with the language', () => {
    const SUFFIXED_FIELD = /\b\w+(Zh|En)\s*:\s*(['"`]|\[)/g
    // changelogData 的 `titleEn` / `detailsEn` 是同一形状但另一件事：130 个版本的内容翻译欠账，
    // 而且那个数组必须是严格 JSON（发布脚本靠 JSON.parse 抠它，键得带引号），搬不进 locale。
    // 它有自己的守卫：changelogBilingual.test.ts。
    const GATES = ['src/shared/config/changelogData.ts']
    /** 文件（相对仓库根）→ 还允许存在的带语言后缀字段数 */
    const SUFFIXED_BUDGET: Record<string, number> = {
      // ---- 数据表整张是双语的：描述、用法示例、环境变量标签 ----
      'src/shared/config/mcpPresets.ts': 113,
      'src/renderer/agent/prompts/promptTemplates.ts': 16,
    }
    const found: Record<string, number> = {}
    for (const root of ROOTS) scan(path.join(REPO_ROOT, root), SUFFIXED_FIELD, found, { gates: GATES })
    expect(found).toEqual(SUFFIXED_BUDGET)
  })

  /**
   * 形态 4：双语元组 `['待审阅', 'Draft']`。
   *
   * 最阴的一种。读取点是 `map[status]?.[language === 'zh' ? 0 : 1]`，这个三元在形态 1 的清单里
   * 被归进"数组下标，不是文案"—— 理由本身没错，错的是它索引的那张表恰恰是纯文案。
   *
   * 判据是"第一项含汉字、第二项不含汉字"，而不是"有两项"：`usageExamplesZh: ['搜索…', '查找…']`
   * 两条都是中文，那是示例列表，不是 zh/en 对。
   */
  it('never pairs the two languages in a tuple', () => {
    const BILINGUAL_TUPLE =
      /\[\s*(?:'[^']*\p{Script=Han}[^']*'|"[^"]*\p{Script=Han}[^"]*")\s*,\s*(?:'[^'\p{Script=Han}]*'|"[^"\p{Script=Han}]*")\s*\]/gu
    /** 文件（相对仓库根）→ 还允许存在的双语元组数 */
    const TUPLE_BUDGET: Record<string, number> = {}
    const found: Record<string, number> = {}
    for (const root of ROOTS) scan(path.join(REPO_ROOT, root), BILINGUAL_TUPLE, found)
    expect(found).toEqual(TUPLE_BUDGET)
  })

  /**
   * 形态 5，也是前四种都看不见的方向：只有中文、没有英文。
   *
   * 前四种至少两种语言都在，缺的是"搬进 locale 表"；这一种是英文界面下直接漏中文，
   * 而且因为不双语，四条正则一个都不认。
   *
   * 中文字面量在这个仓库里有 200 多处，绝大多数不是文案：注释、logger 输出、LLM prompt 模板、
   * 测试夹具、语言选择器里语言的自称（`native: '中文'` 本来就该是中文）。全数进来会把真正的
   * 问题淹掉，所以只认四种"一定会渲染给用户"的位置，并且先去掉注释再匹配。
   */
  it('never hardcodes Chinese-only user-facing text', () => {
    const CHINESE_ONLY = new RegExp(
      // 每个分支自己也带 `u`：只取 `.source` 时标志不会传下去，但 tsc 对每个字面量单独检查
      // `\p{…}`，缺 `u` 就是 TS1530。运行时用的是下面 join 之后的 `'gu'`。
      [
        // JSX 文本节点 `<div …>无相关模型</div>`。字符集里排掉引号，否则字符串里的 `>`
        // 会误判 —— `'请在“设置 > 服务商”中重新登录。'` 就是一个。
        />[^<>{}\n"'`]*\p{Script=Han}[^<>{}\n"'`]*</u.source,
        // 用户看得见的属性，以及同名的默认参数（`placeholder = '选择日期'`）。
        /(placeholder|title|aria-label|alt|label)\s*=\s*(?:"[^"]*\p{Script=Han}|'[^']*\p{Script=Han}|\{\s*['"`][^'"`]*\p{Script=Han})/u
          .source,
        // 抛给用户看的错误。`\s*` 必须能跨行：OpenAIAuthService 把 `new Error(` 和文案分了两行。
        /new Error\(\s*(?:'[^']*\p{Script=Han}|"[^"]*\p{Script=Han}|`[^`]*\p{Script=Han})/u.source,
        // toast / 确认框。
        /(toast\.\w+|globalConfirm)\(\s*\{?\s*(?:message\s*:\s*)?(?:'[^']*\p{Script=Han}|"[^"]*\p{Script=Han}|`[^`]*\p{Script=Han})/u
          .source,
      ].join('|'),
      'gu',
    )
    // 写给程序员看的不变量断言：只在"某个调用点把自己嵌进了别人的 set()"时抛，用户永远看不到，
    // 翻译它没有意义 —— 它要传达的信息是"这行代码写错了"，读者是写代码的人。
    const DEV_ASSERTIONS = ['src/renderer/agent/store/storeUpdaterGuard.ts']
    /** 文件（相对仓库根）→ 还允许存在的单语中文文案数 */
    const CHINESE_ONLY_BUDGET: Record<string, number> = {}
    const found: Record<string, number> = {}
    for (const root of ROOTS) {
      scan(path.join(REPO_ROOT, root), CHINESE_ONLY, found, { stripComments: true, gates: DEV_ASSERTIONS })
    }
    expect(found).toEqual(CHINESE_ONLY_BUDGET)
  })

  it('never branches whole text blocks on the language', () => {
    // 三元只是最显眼的写法。同一件事还有两种躲过上面那条正则的形态，这个 pocket 就是这么活下来的：
    // 1. `if (language === 'zh') { return '整段中文' }` + 下面一段一模一样结构的英文
    //    —— 两个分支各自拼一遍 sections 数组，加一种语言要改两处。
    // 2. `getLocalizedText(language, zh, en)` 这类把双语对藏进函数参数的 helper
    //    —— 调用点看着很干净，实际上文案还是内联的，locale 表里一个字都没有。
    // 例外只有一种：按语言决定要不要走某条数据通路（比如一言 API 只有中文内容），
    // 这种分支里不带任何文案，写在 DATA_GATES 里。
    const DATA_GATES = ['src/renderer/components/welcome/poster/workPosterQuote.ts']
    const LANGUAGE_BLOCK =
      /if\s*\(\s*(language|lang|locale)\s*(===|!==)\s*['"](zh|en)['"]\s*\)|\(\s*(language|lang)\s*:\s*\w+\s*,\s*zh\s*:\s*string\s*,\s*en\s*:\s*string/g
    const offenders: Record<string, number> = {}
    for (const root of ROOTS) scan(path.join(REPO_ROOT, root), LANGUAGE_BLOCK, offenders, { gates: DATA_GATES })
    expect(offenders).toEqual({})
  })

  it('never lets a t() call site cast its key', () => {
    // `t('foo' as any, lang)` 绕过 TranslationKey 检查，键不存在时 t() 会把键名原样
    // 显示给用户（返回值是 key 本身，所以 `|| '兜底'` 也救不回来）。
    const CAST_KEY = /t\(\s*['"][^'"]+['"]\s+as\s+any/g
    const offenders: Record<string, number> = {}
    for (const root of ROOTS) scan(path.join(REPO_ROOT, root), CAST_KEY, offenders)
    expect(offenders).toEqual({})
  })

  it('never puts a dead fallback after t()', () => {
    // `t('copy', language) || '复制'`：t() 找不到键时返回键名本身，键名是真值，所以
    // `||` 右边永远不执行 —— 它唯一的作用是让"这里其实没接进 locale 表"看起来已经处理过了。
    // 真缺键时用户看到的是 `copy` 这种小写键名，兜底一个字也救不回来。
    const DEAD_FALLBACK = /\bt\(\s*['"][^'"]+['"][^)]*\)\s*\|\|\s*['"`]/g
    const offenders: Record<string, number> = {}
    for (const root of ROOTS) scan(path.join(REPO_ROOT, root), DEAD_FALLBACK, offenders)
    expect(offenders).toEqual({})
  })
})
