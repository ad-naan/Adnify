/**
 * 语言包一致性。
 *
 * `TranslationKey = keyof typeof en`，所以 zh 少一个 key 时 TS 不会报错 —— `t()`
 * 会静默退回英文，界面变成中英混排，而且没有任何测试会红。这条测试就是那道闸门。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { en } from '@shared/i18n/locales/en'
import { zh } from '@shared/i18n/locales/zh'
import { asLanguage, t } from '@shared/i18n'

const enKeys = Object.keys(en) as Array<keyof typeof en>
const zhKeys = Object.keys(zh) as Array<keyof typeof zh>

const SOURCE_ROOT = path.resolve(__dirname, '../../../src')

/**
 * `src` 下所有 ts/tsx 里出现过的字符串字面量（单引号、双引号、反引号都算）。
 * locale 表本身要排掉 —— 键在那里的定义处当然是字面量，算进来这条守卫就永远是空的。
 */
function collectQuotedLiterals(dir: string, into: Set<string>): Set<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'locales') collectQuotedLiterals(full, into)
    } else if (/\.tsx?$/.test(entry.name)) {
      const source = fs.readFileSync(full, 'utf8')
      for (const match of source.matchAll(/['"`]([A-Za-z][A-Za-z0-9_.]*)['"`]/g)) into.add(match[1])
    }
  }
  return into
}

describe('i18n locale parity', () => {
  it('has the same key set in both locales', () => {
    expect(zhKeys.filter(key => !(key in en))).toEqual([])
    expect(enKeys.filter(key => !(key in zh))).toEqual([])
  })

  it('has no empty translations', () => {
    expect(enKeys.filter(key => !en[key].trim())).toEqual([])
    expect(zhKeys.filter(key => !zh[key].trim())).toEqual([])
  })

  it('keeps the same interpolation placeholders in both locales', () => {
    const placeholders = (text: string) => (text.match(/\{[a-zA-Z0-9_]+\}/g) || []).sort()
    const mismatched = enKeys.filter(key => {
      const translated = zh[key as keyof typeof zh]
      return translated !== undefined && placeholders(en[key]).join() !== placeholders(translated).join()
    })
    expect(mismatched).toEqual([])
  })

  it('never leaves an untranslated Chinese string in the English locale', () => {
    // 中英文案写反过一次就会一直反着，靠肉眼在 700+ 条里发现不现实。
    expect(enKeys.filter(key => /[一-龥]/.test(en[key]))).toEqual([])
  })

  /**
   * 反方向：zh 里留着英文原文。
   *
   * 上面那条只查 en 里有没有汉字，漏译的方向查不到 —— 复制一行忘了改中文，两边一模一样，
   * 键集平价、占位符、非空全都过。
   *
   * 不能要求"zh 值必须含汉字"：产品名、`Git`、URL 占位符这类正当的纯 ASCII 值本来就存在。
   * 所以按棘轮来 —— 冻结今天这几个两边相同的键，只允许变小。新加的键要么真的翻了，
   * 要么必须显式写进这份清单，评审时看得见。
   */
  it('only ever shrinks the list of keys left identical in both locales', () => {
    // `settingsSearch.systemGithubToken` 是"GitHub Token"：设置里那一项的中文标签本来就是
    // 这个英文词（`SystemSettings.tsx` 的标题也是），不是漏译。它从 `settingsSearchIndex.ts`
    // 的 `label: { en: 'GitHub Token', zh: 'GitHub Token' }` 原样搬过来 —— 那个双语对两边
    // 完全一样，也正是这条棘轮存在的理由：搬进 locale 之后它才第一次被记在案上。
    const IDENTICAL = [
      'app.name',
      'git.cloneUrlPlaceholder',
      'git.title',
      'kb.category.Git',
      'settingsSearch.systemGithubToken',
      'welcome.brandName',
    ]
    expect(enKeys.filter(key => zh[key as keyof typeof zh] === en[key]).sort()).toEqual(IDENTICAL)
  })

  /**
   * 没有任何代码引用的键。
   *
   * 上面几条只看两个表之间的关系，看不见"这个键还有没有人用"。后果是删组件时文案会留下：
   * `EmotionEditorBar` 被删掉时带走了 26 个 `emotion.editor.*`，而那个组件从来没有被挂载过
   * —— 那 26 条在表里躺了七个月，`localeParity` 全程是绿的。
   *
   * 判据是"这个键作为字符串字面量在 src 里出现过"，所以存进 `Record<X, TranslationKey>`
   * 再间接用的键（本仓库有 16 张这种表）照样算被引用。运行时拼出来的键
   * （`t(`cmd.${cmd.id}`)`）没有字面量，前缀记在 `RUNTIME_PREFIXES` 里 —— 它们不是孤儿，
   * 是模板字面量类型在编译期保证的。
   *
   * 和上面 IDENTICAL 一样是棘轮：清单里是今天的存量，绝大多数是 Region A 的历史遗留
   * （`login` / `register` / `forgotPassword` 这类整套没实现过的界面）。只允许变小。
   */
  it('never grows the set of keys no code references', () => {
    const RUNTIME_PREFIXES = [
      'agent.typing.', 'cmd.', 'errorCode.', 'gitExcludeService.', 'kb.category.',
      'planReview.risk.', 'providerAuthError.', 'providerSettings.effort.',
      'securityReason.', 'useFileSave.error.', 'worktreeLane.reason.', 'worktreeLane.status.',
    ]
    const UNREFERENCED: string[] = [
      'agent.status.generating', 'agent.status.toolCalling', 'agent.systemInstructionsPlaceholder', 'agentMode',
      'agentModeDesc', 'agentModeHint', 'aiAssistant', 'aiProcessing',
      'app.name', 'askAiSearch', 'askAnything', 'baseUrlHint',
      'changelog.allVersions', 'changelog.features', 'changelog.fixes', 'changelog.improvements',
      'changelog.newVersionNotice', 'changelog.security', 'changelog.viewChangelog', 'changelog.whatsNew',
      'chatModeDesc', 'chatModeHint', 'chunks', 'codePreview',
      'codebaseIndex', 'codebaseSearch', 'confirmChangeDataDir', 'confirmClearIndex',
      'confirmDelete', 'confirmDeleteSession', 'confirmRemoveRoot', 'copyCode',
      'copyFile', 'createFile', 'currentFileSymbols', 'deleteFile',
      'deleteSession', 'diffPreview', 'editFile', 'editMessage',
      'editorWelcome.commandsSubtitle', 'editorWelcome.searchSubtitle', 'emptySession', 'enterApiKey',
      'error.quotaExceeded', 'error.whitelistBlocked', 'executeCommand', 'filesCount',
      'filesToInclude', 'forgotPassword', 'fullRender', 'generate',
      'git.changedFiles', 'git.generating', 'git.refreshStatus', 'gitChanges',
      'gitControl', 'hasAccount', 'howCanIHelp', 'inSelection',
      'inlineAiEdit', 'linesAdded', 'linesRemoved', 'listDirectory',
      'loadSession', 'login', 'logout', 'needConfirmation',
      'noAccount', 'noSessions', 'notIndexed', 'oauthSignInWarning',
      'original', 'pressEnterApply', 'pressEnterGenerate', 'preview.servers.readyCount',
      'preview.tab.blockedNavigation', 'preview.tab.copied', 'preview.toast.notNow', 'profile',
      'proposedChanges', 'rawArguments', 'readFile', 'receivingData',
      'regenerateResponse', 'register', 'replaceInSelection', 'requestTimeout',
      'retry', 'returnToSend', 'runCode', 'runCommand',
      'saveSettings', 'searchFile', 'searchFiles', 'settings.managePreferences',
      'success.fileSaved', 'success.indexComplete', 'terminalOutput', 'textResults',
      'toolArguments', 'toolCopyResult', 'toolResult', 'toolResultFor',
      'toolStreaming', 'toolTruncated', 'toolWaitingApproval', 'virtualized',
      'welcome.brandName', 'welcome.brandTagline', 'welcome.feature.connect.subtitle', 'welcome.feature.connect.title',
      'welcome.feature.modular.subtitle', 'welcome.feature.modular.title', 'welcome.feature.visual.subtitle', 'welcome.feature.visual.title',
      'welcome.openFolderDesc', 'welcome.openWorkspaceDesc', 'welcome.pressForCommands', 'welcomeDesc',
      'writeFile', 'writing',
    ]
    const referenced = collectQuotedLiterals(SOURCE_ROOT, new Set<string>())
    const orphans = enKeys.filter(key =>
      !referenced.has(key) && !RUNTIME_PREFIXES.some(prefix => key.startsWith(prefix)))
    expect(orphans.map(String).sort()).toEqual(UNREFERENCED)
  })

  it('normalizes unknown store languages to English', () => {
    expect(asLanguage('zh')).toBe('zh')
    expect(asLanguage('en')).toBe('en')
    expect(asLanguage(undefined)).toBe('en')
    expect(asLanguage('fr')).toBe('en')
  })

  it('substitutes parameters instead of leaking the placeholder', () => {
    expect(t('worktreeLane.dropConfirm', 'zh', { branch: 'adnify/lane-x' })).toContain('adnify/lane-x')
    expect(t('worktreeLane.dropConfirm', 'en', { branch: 'adnify/lane-x' })).not.toContain('{branch}')
  })

  /**
   * 闪屏首帧的文案只能写在 index.html 里 —— 它在 bundle 加载之前就绘制了，拿不到
   * locale 表。所以那两句是唯一允许存在的重复，代价是可能和 locale 表漂移：这条测试
   * 把 `data-splash-key` 对应的英文（标签内容）和中文（`data-splash-zh`）都钉到表上。
   */
  it('keeps the splash first frame in sync with the locale table', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../../index.html'), 'utf8')
    const spans = [...html.matchAll(/<span data-splash-key="([^"]+)" data-splash-zh="([^"]+)">([^<]+)<\/span>/g)]
    expect(spans.length).toBe(2)
    for (const [, key, chinese, english] of spans) {
      expect(en[key as keyof typeof en]).toBe(english)
      expect(zh[key as keyof typeof zh]).toBe(chinese)
    }
  })
})
