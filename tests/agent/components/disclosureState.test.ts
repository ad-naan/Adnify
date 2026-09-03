/**
 * 自动展开/收起的判据。
 *
 * 时间轴钉在底部，一行变矮浏览器就把 scrollTop 夹回去 —— 收起是"向下的"。所以收起的时机不能
 * 由这一行自己拍脑袋定，而要等后继阶段挂载来接手（`holdOpen`）：收和长落在同一次提交里，
 * 再配合滚动容器的折叠余量（按住文档总高），让出的空间从底部出，上面的内容一动不动。
 *
 * 这里守的就是那张状态表：谁在按着、谁该收、用户点过的行谁都别碰。
 */
import { describe, expect, it } from 'vitest'
import { decideDisclosureAction } from '@renderer/hooks/useDisclosureState'

const decide = (overrides: Partial<Parameters<typeof decideDisclosureAction>[0]> = {}) =>
  decideDisclosureAction({
    openWhile: false,
    holdOpen: false,
    autoClose: true,
    wasAutoOpen: false,
    userControlled: false,
    ...overrides,
  })

describe('disclosure auto-open decision', () => {
  it('opens while the row has live content', () => {
    expect(decide({ openWhile: true })).toBe('open')
    expect(decide({ openWhile: true, autoClose: false })).toBe('open')
    // 正在跑的行永远优先展开，就算它同时被按着。
    expect(decide({ openWhile: true, holdOpen: true })).toBe('open')
  })

  it('does nothing for a settled row that never auto-opened', () => {
    expect(decide({})).toBe('idle')
    expect(decide({ holdOpen: true })).toBe('idle')
    expect(decide({ autoClose: false })).toBe('idle')
  })

  it('holds an auto-opened row open while it is still the presented stage', () => {
    // 交接式收起：还没有后继行来接手，这时候收就是让整屏内容往下坠。
    expect(decide({ wasAutoOpen: true, holdOpen: true })).toBe('hold')
  })

  it('closes an auto-opened row once a successor stage has taken over', () => {
    expect(decide({ wasAutoOpen: true })).toBe('close')
  })

  it('holds instead of closing when the caller opted out of auto-close', () => {
    expect(decide({ wasAutoOpen: true, autoClose: false })).toBe('hold')
  })

  it('does not close a row that was never auto-opened', () => {
    expect(decide({ wasAutoOpen: false })).toBe('idle')
  })

  it('leaves an explicitly toggled row alone', () => {
    expect(decide({ userControlled: true, openWhile: true })).toBe('idle')
    expect(decide({ userControlled: true, wasAutoOpen: true, holdOpen: true })).toBe('idle')
    expect(decide({ userControlled: true, wasAutoOpen: true })).toBe('idle')
  })
})
