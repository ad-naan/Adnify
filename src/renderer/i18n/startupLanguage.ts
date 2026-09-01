/**
 * 启动语言缓存。
 *
 * 真正的语言设置存在 electron-store 里，只能异步读到 —— 而 `index.html` 的闪屏在
 * 那之前就已经渲染了。默认语言是 en，闪屏却曾经把中文写死在 HTML 里，于是英文用户
 * 每次启动都先看到一屏中文。
 *
 * 所以把语言镜像到 localStorage（同步可读），闪屏的内联脚本用它决定首帧文案，
 * 设置加载完成后再校正。localStorage 只是缓存，权威值永远是设置里的那个。
 */
import { asLanguage, type Language } from '@shared/i18n'

export const STARTUP_LANGUAGE_KEY = 'adnify-language'

/** 设置加载/变更后写回缓存，供下次启动的首帧使用 */
export function cacheStartupLanguage(language: string | undefined | null): void {
  try {
    localStorage.setItem(STARTUP_LANGUAGE_KEY, asLanguage(language))
  } catch {
    // 隐私模式 / 配额满：缓存丢了只影响首帧文案，不值得打断启动
  }
}

/** 首帧可用的语言：缓存命中就用它，否则回落到默认语言 */
export function readStartupLanguage(): Language {
  try {
    return asLanguage(localStorage.getItem(STARTUP_LANGUAGE_KEY))
  } catch {
    return asLanguage(null)
  }
}
