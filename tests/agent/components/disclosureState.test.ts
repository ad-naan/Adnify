/**
 * 自动展开的判据。
 *
 * 时间轴钉在底部，所以每一次自动收起都会把可见内容往下顶一段（浏览器把 scrollTop 夹回去）。
 * 这里守的就是"什么时候允许收"：跑完不收，等这一行不再是当前呈现的阶段 —— 也就是后继行
 * 挂载的那一刻 —— 才收，让一涨一缩落在同一次提交里。
 */
import { describe, expect, it } from 'vitest'
import { decideDisclosureAction } from '@renderer/hooks/useDisclosureState'

const decide = (overrides: Partial<Parameters<typeof decideDisclosureAction>[0]> = {}) =>
  decideDisclosureAction({
    openWhile: false,
    holdOpenWhile: false,
    wasAutoOpen: false,
    userControlled: false,
    ...overrides,
  })

describe('disclosure auto-open decision', () => {
  it('opens while the row has live content', () => {
    expect(decide({ openWhile: true })).toBe('open')
    expect(decide({ openWhile: true, holdOpenWhile: true })).toBe('open')
  })

  it('never opens a settled row just because it is the presented stage', () => {
    // 这是"最新一条工具先展开后折叠"的根：呈现本身不再是展开的理由。
    expect(decide({ holdOpenWhile: true })).toBe('hold')
    expect(decide({})).toBe('idle')
  })

  it('holds an auto-opened row instead of closing it mid-presentation', () => {
    expect(decide({ holdOpenWhile: true, wasAutoOpen: true })).toBe('hold')
  })

  it('closes exactly when presentation hands off to the successor stage', () => {
    expect(decide({ wasAutoOpen: true })).toBe('close')
  })

  it('does not close a row that was never auto-opened', () => {
    expect(decide({ wasAutoOpen: false })).toBe('idle')
  })

  it('leaves an explicitly toggled row alone', () => {
    expect(decide({ userControlled: true, openWhile: true })).toBe('idle')
    expect(decide({ userControlled: true, holdOpenWhile: true, wasAutoOpen: true })).toBe('idle')
    expect(decide({ userControlled: true, wasAutoOpen: true })).toBe('idle')
  })
})
