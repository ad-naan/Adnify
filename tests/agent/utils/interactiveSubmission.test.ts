/**
 * ask_user 卡片的提交语义。
 *
 * 这些判断以前埋在组件的 onClick 里，只能靠手点验证；而它们决定的正是最贵的一类
 * 错误——答案送出去之后模型就按它干活了，用户在界面上看不出选错了。
 *
 * 被测函数住在 agent/utils 而不是组件文件里：组件一路 import 到 monaco 门面，
 * node 测试环境下加载就会抛（setup.ts 的 mainWindow 门只够 monaco 自己不炸）。
 */
import { describe, expect, it } from 'vitest'
import {
  decideCustomDraftVisibility,
  isCustomOption,
  resolveInteractiveSubmission,
} from '@/renderer/agent/utils/interactiveResponse'
import type { InteractiveOption } from '@/renderer/agent/types'

const options: InteractiveOption[] = [
  { id: 'feature', label: 'New Feature' },
  { id: 'bugfix', label: 'Bug Fix' },
  { id: 'custom', label: 'Custom response' },
]

describe('ask_user option classification', () => {
  it.each([
    ['custom', 'Anything'],
    ['other', 'Anything'],
    ['opt-custom-1', 'Anything'],
    ['anything', 'Other'],
    ['anything', '自定义'],
  ])('treats %s / %s as the custom row', (id, label) => {
    expect(isCustomOption({ id, label })).toBe(true)
  })

  it.each([
    ['customary', 'Customary'],
    ['customization', 'Customization'],
    ['another-way', 'Elsewhere'],
    ['feature', 'New Feature'],
  ])('keeps %s / %s a normal option', (id, label) => {
    expect(isCustomOption({ id, label })).toBe(false)
  })
})

describe('ask_user submission', () => {
  it('answers with the selected option', () => {
    expect(resolveInteractiveSubmission(options, ['bugfix'], ''))
      .toEqual({ kind: 'choice', ids: ['bugfix'] })
  })

  it('answers with every selected option in multi-select', () => {
    expect(resolveInteractiveSubmission(options, ['feature', 'bugfix'], ''))
      .toEqual({ kind: 'choice', ids: ['feature', 'bugfix'] })
  })

  it('refuses to submit an empty answer', () => {
    expect(resolveInteractiveSubmission(options, [], '')).toBeNull()
    expect(resolveInteractiveSubmission(options, [], '   ')).toBeNull()
  })

  it('lets a lone text answer stand on its own', () => {
    expect(resolveInteractiveSubmission(options, [], '  use SQLite  '))
      .toEqual({ kind: 'custom', ids: [], text: 'use SQLite' })
  })

  it('prefers the text when the custom row is selected', () => {
    expect(resolveInteractiveSubmission(options, ['custom'], 'use SQLite'))
      .toEqual({ kind: 'custom', ids: ['custom'], text: 'use SQLite' })
  })

  it('ignores text typed next to a non-custom option', () => {
    // 顺手写了点什么不该被当成对另一个选项的回答送出去。
    expect(resolveInteractiveSubmission(options, ['feature'], 'just a note'))
      .toEqual({ kind: 'choice', ids: ['feature'] })
  })

  it('sends one answer per option when both custom text and options are selected', () => {
    expect(resolveInteractiveSubmission(options, ['feature', 'custom'], 'use SQLite'))
      .toEqual({ kind: 'custom', ids: ['feature', 'custom'], text: 'use SQLite' })
  })

  it('drops ids that are not part of the question', () => {
    expect(resolveInteractiveSubmission(options, ['feature', 'ghost'], ''))
      .toEqual({ kind: 'choice', ids: ['feature'] })
  })
})

describe('custom draft visibility', () => {
  it('keeps the input open while a draft exists', () => {
    expect(decideCustomDraftVisibility(true, 'half-written')).toBe(true)
  })

  it('closes the input when nothing was typed', () => {
    expect(decideCustomDraftVisibility(true, '   ')).toBe(false)
  })

  it('stays closed once closed', () => {
    expect(decideCustomDraftVisibility(false, 'half-written')).toBe(false)
  })
})
