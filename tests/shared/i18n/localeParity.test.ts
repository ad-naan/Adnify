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
