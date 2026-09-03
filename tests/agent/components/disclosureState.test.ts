/**
 * 自动展开的判据。
 *
 * 时间轴钉在底部，所以自动收起是向下的：一行变矮，浏览器把 scrollTop 夹回去，它上面的
 * 内容整段往下坠。自动展开再自动收起就是一涨一缩，幅度等于抽屉里那坨内容的高度 ——
 * 那就是"内容一直上下摆动"。所以时间轴上的行传 `autoClose: false`：自动只往一个方向动，
 * 收起只由用户点。这里守的就是这条。
 */
import { describe, expect, it } from 'vitest'
import { decideDisclosureAction } from '@renderer/hooks/useDisclosureState'

const decide = (overrides: Partial<Parameters<typeof decideDisclosureAction>[0]> = {}) =>
  decideDisclosureAction({
    openWhile: false,
    autoClose: true,
    wasAutoOpen: false,
    userControlled: false,
    ...overrides,
  })

describe('disclosure auto-open decision', () => {
  it('opens while the row has live content', () => {
    expect(decide({ openWhile: true })).toBe('open')
    expect(decide({ openWhile: true, autoClose: false })).toBe('open')
  })

  it('does nothing for a settled row that never auto-opened', () => {
    expect(decide({})).toBe('idle')
    expect(decide({ autoClose: false })).toBe('idle')
  })

  it('holds an auto-opened row open when the caller opted out of auto-close', () => {
    // 时间轴上的行走这条：跑完就停在展开态，不再自己缩回去。
    expect(decide({ wasAutoOpen: true, autoClose: false })).toBe('hold')
  })

  it('closes an auto-opened row only when auto-close is allowed', () => {
    expect(decide({ wasAutoOpen: true })).toBe('close')
  })

  it('does not close a row that was never auto-opened', () => {
    expect(decide({ wasAutoOpen: false })).toBe('idle')
  })

  it('leaves an explicitly toggled row alone', () => {
    expect(decide({ userControlled: true, openWhile: true })).toBe('idle')
    expect(decide({ userControlled: true, wasAutoOpen: true, autoClose: false })).toBe('idle')
    expect(decide({ userControlled: true, wasAutoOpen: true })).toBe('idle')
  })
})
