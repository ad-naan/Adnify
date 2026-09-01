/**
 * 车道文案的唯一出口。
 *
 * 之前 service 层直接回传英文句子，UI 再各自拼中英分支；这里钉住"原因码进、
 * 当前语言的完整句子出"，并且保证每个原因码都有中英两版翻译。
 */
import { describe, expect, it } from 'vitest'
import { laneNoticeText, lanePlacementText, laneOutcomeText } from '@/renderer/agent/orchestration/laneNoticeText'
import type { ExecutionLaneNoticeCode } from '@/shared/types/executionLane'
import { en } from '@/renderer/i18n/locales/en'
import { zh } from '@/renderer/i18n/locales/zh'

const CODES: ExecutionLaneNoticeCode[] = [
  'noRepository', 'noCommits', 'dirtyBase', 'createFailed', 'dirtyBaseMerge', 'baseBranchChanged',
  'conflicts', 'mergeFailed', 'commitFailed', 'cleanupFailed', 'keptForRecovery', 'emptyDiscarded',
  'notLaneBranch', 'laneStillRunning',
]

describe('laneNoticeText', () => {
  it('translates every notice code in both locales', () => {
    for (const code of CODES) {
      const key = `worktreeLane.reason.${code}` as keyof typeof en
      expect(en[key], `missing en text for ${code}`).toBeTruthy()
      expect(zh[key], `missing zh text for ${code}`).toBeTruthy()
      expect(laneNoticeText({ code }, 'zh')).not.toBe(key)
    }
  })

  it('fills in parameters', () => {
    expect(laneNoticeText({ code: 'baseBranchChanged', params: { current: 'hotfix', base: 'main' } }, 'en'))
      .toBe('The workspace is now on hotfix instead of the lane base main, so this lane was not merged.')
    expect(laneNoticeText({ code: 'conflicts', params: { files: 'src/a.ts, src/b.ts' } }, 'zh'))
      .toContain('src/a.ts, src/b.ts')
  })

  it('falls back to the Git detail only when there is no notice code', () => {
    expect(laneNoticeText(undefined, 'en', 'fatal: not a git repository')).toBe('fatal: not a git repository')
    expect(laneNoticeText({ code: 'mergeFailed' }, 'en', 'fatal: refusing to merge')).toBe('Merge failed.')
    expect(laneNoticeText(undefined, 'en')).toBe('')
  })

  it('describes where the lane went', () => {
    expect(lanePlacementText({ branch: 'adnify/lane-a', archived: true }, 'en')).toContain('adnify/lane-a')
    expect(lanePlacementText({ branch: 'adnify/lane-a', path: 'D:/repo/.adnify/worktrees/a', archived: false }, 'zh'))
      .toContain('D:/repo/.adnify/worktrees/a')
    // 既没归档也没路径时不要输出半句话
    expect(lanePlacementText({ branch: 'adnify/lane-a' }, 'en')).toBe('')
  })

  it('combines the cause and the placement into one sentence', () => {
    const text = laneOutcomeText({
      branch: 'adnify/lane-a',
      archived: true,
      notice: { code: 'dirtyBaseMerge' },
    }, 'en')
    expect(text).toBe('The base workspace has uncommitted changes, so this lane was not merged. The worktree folder was reclaimed; the commits are still on branch adnify/lane-a.')
  })

  it('keeps the Git detail alongside the translated cause', () => {
    // "Merge failed." 分不出真冲突和 index.lock 被占，而原文我们本来就有。
    const text = laneOutcomeText({
      branch: 'adnify/lane-a',
      archived: true,
      notice: { code: 'mergeFailed' },
      error: 'fatal: Unable to create .git/index.lock: File exists',
    }, 'en')
    expect(text).toContain('Merge failed.')
    expect(text).toContain('index.lock')
  })

  it('does not repeat the detail when it was already used as the fallback', () => {
    const text = laneOutcomeText({ branch: 'adnify/lane-a', error: 'fatal: boom' }, 'en')
    expect(text.match(/fatal: boom/g)).toHaveLength(1)
  })
})
