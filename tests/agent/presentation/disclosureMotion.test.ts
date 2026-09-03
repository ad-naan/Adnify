/**
 * 时间轴上"一次可见的高度变化"有多长，节拍就不能比它短。
 *
 * 这些数不是审美参数，它们之间的关系决定了滚动位置有几个写者：
 *
 * - 入场动画（`tool-row-enter`，480ms）动的是真高度。节拍比它短，就会有好几行同时在长高；
 *   Virtuoso 开着 `skipAnimationFrameInResizeObserver`，每帧的高度变化都同步走一遍它的补偿，
 *   我们的 `stickToBottom` 又在同一帧写 `scrollTop` —— 两个写者抢一个值，正在流的文字就抖。
 * - 收起会让底部跟随停 `AGENT_BOTTOM_FOLLOW_PAUSE_MS`。节拍比它短，下一次收起会在上一次的
 *   停顿里续上，跟随被连续掐着：文字照长、视口不跟，等某次停顿过期再一把拽回底部。
 *
 * 这个测试就是那条不变量的锚：以后谁调快节拍，先在这里失败，而不是在用户眼里抖。
 */
import { describe, expect, it } from 'vitest'
import {
  AGENT_BOTTOM_FOLLOW_PAUSE_MS,
  AGENT_BOTTOM_FOLLOW_PAUSE_PADDING_MS,
  AGENT_DISCLOSURE_COLLAPSE_MS,
  AGENT_PLAYBACK_RELEASE_MS,
  AGENT_ROW_ENTER_MS,
} from '@renderer/agent/presentation/disclosureMotion'

describe('disclosure motion timing invariants', () => {
  it('never releases a stage before the entrance animation finishes', () => {
    expect(AGENT_PLAYBACK_RELEASE_MS).toBeGreaterThanOrEqual(AGENT_ROW_ENTER_MS)
  })

  it('never releases a stage while the previous collapse still has bottom-follow paused', () => {
    expect(AGENT_PLAYBACK_RELEASE_MS).toBeGreaterThanOrEqual(AGENT_BOTTOM_FOLLOW_PAUSE_MS)
  })

  it('outlasts the collapse animation itself, with padding', () => {
    expect(AGENT_BOTTOM_FOLLOW_PAUSE_MS).toBe(AGENT_DISCLOSURE_COLLAPSE_MS + AGENT_BOTTOM_FOLLOW_PAUSE_PADDING_MS)
    expect(AGENT_BOTTOM_FOLLOW_PAUSE_PADDING_MS).toBeGreaterThan(0)
  })
})
