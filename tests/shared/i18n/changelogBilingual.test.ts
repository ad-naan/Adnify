/**
 * 更新日志的双语覆盖。
 *
 * `releaseText` / `releaseList` 缺英文时静默退回中文（`en: en ?? zh`）—— 英文界面下一条没翻的
 * 明细和"这版本来就这么写"长得一模一样，130 个版本没人会逐条核对，所以只能靠测试盯。
 *
 * 这里分两件事：
 * 1. **新版本必须全双语**。1.7.56 起每个版本 highlight / title / label / details 都是齐的，
 *    这条测试把这个起点钉住 —— 往上再加版本，漏一个 `xEn` 就红。
 * 2. **历史欠账只允许变少**。1.7.55 及更早是内容翻译的活（不是代码问题），一次翻不完，
 *    所以只锁数量：翻完一批就把 `BACKLOG` 的数字改小，或者把 `BILINGUAL_SINCE` 往下调。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { CHANGELOG_DATA } from '@shared/config/changelogData'

const REPO_ROOT = path.resolve(__dirname, '../../..')

/** 从这个版本起要求全双语。历史版本翻完一批，就把它往下调。 */
const BILINGUAL_SINCE = '1.7.56'

/**
 * 还只有中文的条目数（全量统计，但按上面那条测试，1.7.56 及以上贡献 0，所以这些全在欠账里）。
 * 只允许变小。
 */
const BACKLOG = { detailsEn: 387, titleEn: 412, labelEn: 185 }

/** `1.7.20.1` 这种四段版本号是真实存在的，预发布后缀（`1.8.0-beta.1`）也要能比。 */
const VERSION_SHAPE = /^\d+(\.\d+)*(-[0-9A-Za-z.]+)?$/

function compareVersions(a: string, b: string): number {
  const parse = (version: string) => version.split('-')[0].split('.').map(Number)
  const [left, right] = [parse(a), parse(b)]
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

describe('changelog bilingual coverage', () => {
  it('keeps every version number comparable', () => {
    // compareVersions 按数字分段比大小。版本号一旦不是这个形状，`Number('x')` 是 NaN，
    // 比较结果恒为假 —— 那条记录会被静静地算到 cutoff 以下，新版本就绕过了下面的守卫。
    expect(CHANGELOG_DATA.filter(release => !VERSION_SHAPE.test(release.version)).map(r => r.version)).toEqual([])
  })

  it(`translates every field on releases from ${BILINGUAL_SINCE} up`, () => {
    const missing: string[] = []
    for (const release of CHANGELOG_DATA) {
      if (compareVersions(release.version, BILINGUAL_SINCE) < 0) continue
      if (release.title && !release.titleEn) missing.push(`${release.version}: titleEn`)
      if (release.highlight && !release.highlightEn) missing.push(`${release.version}: highlightEn`)
      for (const category of release.categories) {
        if (category.label && !category.labelEn) missing.push(`${release.version} [${category.type}]: labelEn`)
        for (const item of category.items) {
          if (item.title && !item.titleEn) missing.push(`${release.version} 「${item.title}」: titleEn`)
          if (item.details?.length && !item.detailsEn?.length) {
            missing.push(`${release.version} 「${item.title}」: detailsEn`)
          }
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('never grows the untranslated backlog', () => {
    let detailsEn = 0
    let titleEn = 0
    let labelEn = 0
    for (const release of CHANGELOG_DATA) {
      for (const category of release.categories) {
        if (category.label && !category.labelEn) labelEn++
        for (const item of category.items) {
          if (item.title && !item.titleEn) titleEn++
          if (item.details?.length && !item.detailsEn?.length) detailsEn++
        }
      }
    }
    expect({ detailsEn, titleEn, labelEn }).toEqual(BACKLOG)
  })

  it('never half-translates a detail list', () => {
    // 条数对不上就是翻了一半。这种比缺字段更糟：`releaseList` 整段换数组，英文界面直接少几条，
    // 连"退回中文"这个兜底都没有。今天 84 条译好的明细一条都没错位，就从这里锁住。
    const mismatched: string[] = []
    for (const release of CHANGELOG_DATA) {
      for (const category of release.categories) {
        for (const item of category.items) {
          const { details, detailsEn } = item
          if (details?.length && detailsEn?.length && details.length !== detailsEn.length) {
            mismatched.push(`${release.version} 「${item.title}」: ${details.length} zh vs ${detailsEn.length} en`)
          }
        }
      }
    }
    expect(mismatched).toEqual([])
  })

  it('keeps CHANGELOG_DATA parseable by the release scripts', () => {
    // scripts/sync-changelog.js 和 generate-release-notes.js 都是"正则抠出数组 + JSON.parse"。
    // 数组里出现注释、单引号、没加引号的键或者尾随逗号：前者报错退出，后者更糟 ——
    // 它把异常 catch 成 `[]`，RELEASE_BODY.md 静悄悄只剩下载表格，发布说明整段丢失。
    const source = fs.readFileSync(path.join(REPO_ROOT, 'src/shared/config/changelogData.ts'), 'utf8')
    const array = source.match(/export const CHANGELOG_DATA: ReleaseNote\[\] = (\[[\s\S]*?\n\])/)
    expect(array).not.toBeNull()
    expect(JSON.parse(array![1])).toHaveLength(CHANGELOG_DATA.length)
  })
})
