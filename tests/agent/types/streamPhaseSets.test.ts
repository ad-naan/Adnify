/**
 * 三个 phase 集合的分工测试。
 *
 * 它们看起来像「同一个概念的三份拷贝」，所以每一轮清理都会有人想把它们合并。这些断言
 * 就是拦住那次合并的绊线：每条都写清了合并会具体弄坏什么。词表本体在 types/thread.ts。
 */

import { describe, it, expect } from 'vitest'

import {
  TURN_ACTIVE_PHASES,
  REQUEST_IN_FLIGHT_PHASES,
  OVERLAY_AUTHORITATIVE_PHASES,
} from '@renderer/agent/types/thread'

describe('stream phase 集合', () => {
  it('等审批时这一轮仍然活跃：否则界面在等人点批准时看起来像已经结束了', () => {
    expect(TURN_ACTIVE_PHASES.has('tool_pending')).toBe(true)
    expect(TURN_ACTIVE_PHASES.has('streaming')).toBe(true)
    expect(TURN_ACTIVE_PHASES.has('tool_running')).toBe(true)
  })

  it('等审批时请求不算在飞：否则人类决策期间会话持久化被无限期挂起', () => {
    expect(REQUEST_IN_FLIGHT_PHASES.has('tool_pending')).toBe(false)
    expect(REQUEST_IN_FLIGHT_PHASES.has('streaming')).toBe(true)
    expect(REQUEST_IN_FLIGHT_PHASES.has('tool_running')).toBe(true)
  })

  it('只有 streaming 时覆盖层权威：加进 tool_running 会放宽 memo 窗口，放大「改了引用不 bump」的不可见问题', () => {
    expect(OVERLAY_AUTHORITATIVE_PHASES.has('streaming')).toBe(true)
    expect(OVERLAY_AUTHORITATIVE_PHASES.has('tool_running')).toBe(false)
    expect(OVERLAY_AUTHORITATIVE_PHASES.has('tool_pending')).toBe(false)
  })

  it('idle / error 三个集合都不包含', () => {
    for (const set of [TURN_ACTIVE_PHASES, REQUEST_IN_FLIGHT_PHASES, OVERLAY_AUTHORITATIVE_PHASES]) {
      expect(set.has('idle')).toBe(false)
      expect(set.has('error')).toBe(false)
    }
  })

  it('三个集合互不相同（大小严格递减）', () => {
    expect(TURN_ACTIVE_PHASES.size).toBe(3)
    expect(REQUEST_IN_FLIGHT_PHASES.size).toBe(2)
    expect(OVERLAY_AUTHORITATIVE_PHASES.size).toBe(1)
  })
})
