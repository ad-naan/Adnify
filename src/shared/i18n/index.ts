/**
 * 国际化。
 *
 * 放在 shared 而不是 renderer：文案是数据，主进程也要用。安全审批弹窗是原生 dialog、
 * 由主进程弹出，它的按钮文案不能由渲染进程传进来（那等于让被审批方决定审批框长什么样），
 * 所以主进程必须能自己查文案 —— 而复制一份字符串表就是冗余。
 */

import { en } from './locales/en'
import { zh } from './locales/zh'

export type Language = 'en' | 'zh'

export const translations = { en, zh } as const

export type TranslationKey = keyof typeof en

/**
 * 占位符的值。允许 undefined 是因为文案里插的往往是可选字段
 * （`result.latency?: number`）；这种情况留空，而不是把 "undefined" 显示给用户。
 */
export type TranslationParams = Record<string, string | number | undefined | null>

/**
 * 取文案。
 *
 * 键不存在时返回键名本身 —— 注意它是 truthy，所以调用点写 `t(...) || '兜底'` 是死代码，
 * 用户看到的会是一串小写键名。缺键要靠 `TranslationKey` 类型和 locale 平价测试拦住。
 */
export function t(key: TranslationKey, lang: Language, params?: TranslationParams): string {
  let text: string = translations[lang][key] || translations.en[key] || key
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      // replaceAll：同一个占位符在一句话里出现两次时，replace 只换第一处，
      // 剩下的会原样漏给用户（"{count} / {count}"）。
      text = text.replaceAll(`{${k}}`, v === undefined || v === null ? '' : String(v))
    })
  }
  return text
}

/**
 * 键是运行时拼出来的时候用这个：命令 ID（`cmd.${cmd.id}`）、分类名（`kb.category.${category}`）
 * 这类键来自注册表，`TranslationKey` 覆盖不到，调用点只能 `as TranslationKey` 强转。
 *
 * 强转的代价是缺键静默：`t()` 缺键返回键名本身且是 truthy，所以后面接 `|| cmd.title` 是死代码 ——
 * 没进 locale 表的命令在界面上显示的是 `cmd.foo.bar` 这串小写键名。这里先查表再决定，
 * 表里没有就用调用方给的 `fallback`（命令自带的标题），于是兜底真的能生效。
 */
export function tDynamic(key: string, lang: Language, fallback: string, params?: TranslationParams): string {
  return Object.hasOwn(en, key) ? t(key as TranslationKey, lang, params) : fallback
}

/** 绑定语言的取文案函数，省掉每个调用点都传一遍 language */
export function createTranslator(lang: Language) {
  return (key: TranslationKey, params?: TranslationParams) => t(key, lang, params)
}

/**
 * 把外部传进来的 `language: string` 收敛成 `Language`。
 *
 * 持久化边界上语言仍然是裸字符串（`AppSettings.language`、electron-store 里的旧值），
 * 组件不该为了拿一个联合类型各自写 `language === 'zh' ? 'zh' : 'en'`；
 * 未知取值统一落到 en（和 `t` 的兜底、`SETTINGS.language.default` 一致）。
 */
export function asLanguage(value: string | undefined | null): Language {
  return value === 'zh' ? 'zh' : 'en'
}

/**
 * 数据本身就是双语的时候用这个：工具调用传进来的审批理由、MCP 预设里的安装说明，
 * 这些文案跟着数据走，locale 表里没有它们的键，`t()` 取不到。
 *
 * 收成一个函数是为了让"按语言选数据"和"按语言查文案"在代码里长得不一样 —— 调用点各自
 * 写 `language === 'zh' ? a : b` 时，这两件事看起来一模一样，评审时没法区分哪个是漏迁移的。
 */
export function pickLocalized(pair: { zh: string; en: string }, lang: Language): string {
  return lang === 'zh' ? pair.zh : pair.en
}

/**
 * BCP 47 标签，给 `toLocaleDateString`、`Intl.*` 和原生窗口用。
 *
 * 单独收在这里是因为它和 `Language` 不是同一个东西：调用点各自写
 * `language === 'zh' ? 'zh-CN' : 'en-US'` 会在加语言时散落一地，而且容易和文案键混淆。
 */
export function toLocaleTag(lang: Language): 'zh-CN' | 'en-US' {
  return lang === 'zh' ? 'zh-CN' : 'en-US'
}
