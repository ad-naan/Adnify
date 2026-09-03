/**
 * 折叠余量：抽屉"往上折叠"，而不是把上面的内容往下拽。
 *
 * 钉在底部的滚动容器里，一行矮了 H，浏览器就把 scrollTop 也夹掉 H —— 视口在文档坐标里整体上移，
 * 于是收起处**下面**的内容看着没动，**上面**的内容一起往下掉 H。那正是"整个内容上下摆动"里
 * 向下的那一半。
 *
 * 办法是收起的同时在容器底部补一块等高的空白，把文档总高按住：scrollTop 不再被夹，上面的内容
 * 一动不动，让出的空间从底部出；之后新长出来的内容先去吃这块空白。这些测试守的就是那三个数：
 * 补多少、最多补多少、什么时候还。
 */
import { describe, expect, it } from 'vitest'
import {
  reconcileCollapseCredit,
  resolveMaxCollapseCredit,
  retireCollapseCredit,
} from '@renderer/agent/presentation/collapseCredit'
import { AGENT_COLLAPSE_CREDIT_VIEWPORT_RATIO } from '@renderer/agent/presentation/disclosureMotion'

describe('collapse credit', () => {
  it('holds the document height while a row shrinks', () => {
    // 收起 300px：补 300px 空白，总高不变，上面的内容一动不动。
    expect(reconcileCollapseCredit({ heldTotal: 2000, contentHeight: 1700, maxCredit: 600 })).toBe(300)
  })

  it('is eaten by whatever grows next instead of settling downwards', () => {
    // 流式正文/下一行工具长出 200px：余量自己让位，总高还是那个数 —— 什么都不用动。
    expect(reconcileCollapseCredit({ heldTotal: 2000, contentHeight: 1900, maxCredit: 600 })).toBe(100)
    expect(reconcileCollapseCredit({ heldTotal: 2000, contentHeight: 2000, maxCredit: 600 })).toBe(0)
    expect(reconcileCollapseCredit({ heldTotal: 2000, contentHeight: 2400, maxCredit: 600 })).toBe(0)
  })

  it('caps the blank tail so a huge drawer cannot empty the viewport', () => {
    // 292 条 lint 明细收起来能有一整屏高。无上限地按住会在底部留一大片空白，
    // 超出上限的部分照旧让浏览器夹（宁愿掉一点，也不留半屏空白）。
    expect(reconcileCollapseCredit({ heldTotal: 3000, contentHeight: 1000, maxCredit: 480 })).toBe(480)
  })

  it('does nothing when nothing is being held', () => {
    expect(reconcileCollapseCredit({ heldTotal: null, contentHeight: 1700, maxCredit: 600 })).toBe(0)
    expect(reconcileCollapseCredit({ heldTotal: 2000, contentHeight: 1700, maxCredit: 0 })).toBe(0)
  })

  it('scales the cap with the viewport', () => {
    expect(resolveMaxCollapseCredit(800)).toBe(Math.floor(800 * AGENT_COLLAPSE_CREDIT_VIEWPORT_RATIO))
    expect(resolveMaxCollapseCredit(0)).toBe(0)
    expect(resolveMaxCollapseCredit(Number.NaN)).toBe(0)
  })
})

describe('collapse credit retirement', () => {
  it('keeps the credit while the view is still pinned to the bottom', () => {
    // 底边就在视口底部，还掉就等于把总高松开 —— 上面的内容会掉下去。
    expect(retireCollapseCredit({ credit: 300, distanceFromBottom: 0 })).toBe(300)
  })

  it('gives back only what is already scrolled past', () => {
    // 只还视口下面已经空着的那部分：还完 scrollTop 仍然合法，屏幕上一个像素都不会动。
    expect(retireCollapseCredit({ credit: 300, distanceFromBottom: 120 })).toBe(180)
    expect(retireCollapseCredit({ credit: 300, distanceFromBottom: 300 })).toBe(0)
    expect(retireCollapseCredit({ credit: 300, distanceFromBottom: 900 })).toBe(0)
  })

  it('is a no-op once there is nothing left to give back', () => {
    expect(retireCollapseCredit({ credit: 0, distanceFromBottom: 900 })).toBe(0)
  })
})
