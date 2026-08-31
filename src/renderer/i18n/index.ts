/**
 * 国际化模块
 * 支持中英文切换
 */

import { en } from './locales/en'
import { zh } from './locales/zh'

export type Language = 'en' | 'zh'

export const translations = { en, zh } as const

export type TranslationKey = keyof typeof en

/**
 * 翻译函数
 * @param key 翻译键
 * @param lang 语言
 * @param params 参数替换
 */
export function t(key: TranslationKey, lang: Language, params?: Record<string, string | number>): string {
  let text: string = translations[lang][key] || translations.en[key] || key
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      text = text.replace(`{${k}}`, String(v))
    })
  }
  return text
}

/**
 * 创建带有预设语言的翻译函数
 */
export function createTranslator(lang: Language) {
  return (key: TranslationKey, params?: Record<string, string | number>) => t(key, lang, params)
}

/**
 * 把 store 里的 `language: string` 收敛成 `Language`。
 *
 * 组件不该为了拿一个联合类型各自写 `language === 'zh' ? 'zh' : 'en'`；
 * 未知取值统一落到 en（和 `t` 的兜底一致）。
 */
export function asLanguage(value: string | undefined | null): Language {
  return value === 'zh' ? 'zh' : 'en'
}

/**
 * 获取所有支持的语言
 */
export function getSupportedLanguages(): Array<{ code: Language; name: string }> {
  return [
    { code: 'en', name: 'English' },
    { code: 'zh', name: '中文' },
  ]
}

/**
 * 检测浏览器语言
 */
export function detectBrowserLanguage(): Language {
  const browserLang = navigator.language.toLowerCase()
  if (browserLang.startsWith('zh')) {
    return 'zh'
  }
  return 'en'
}
