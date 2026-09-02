/**
 * 行为层打分：每个状态都必须真的能被判出来。
 *
 * 这个文件存在的理由是一个具体的 bug：`focused` 在默认灵敏度下曾经**数学上不可达** ——
 * 打字时 `excited` 吃同一个信号且系数更高（0.9 vs 0.7），不打字时 `focused` 的上限
 * 又刚好等于 neutral 先验。8 个状态里最该常见的那个一次都出不来，而当时打分核心是
 * 零覆盖，没有任何测试会红。
 *
 * 所以第一条用例是"八个状态逐个可达"。它不检查阈值调得好不好 —— 那是产品判断 ——
 * 只检查"这个状态存在于代码里但永远不会发生"这一类错。
 */
import { describe, expect, it } from 'vitest'
import { scoreBehavior, type BaselineDeviation, type BehaviorScoringInput } from '@renderer/agent/emotion/behaviorScoring'
import type { BehaviorMetrics } from '@renderer/agent/types/emotion'

/** 未校准的基线：绝大多数用户在攒够 50 个样本之前都走这条路。 */
const UNCALIBRATED: BaselineDeviation = {
  typingSpeedDeviation: 0,
  backspaceRateDeviation: 0,
  fileSwitchDeviation: 0,
  isActiveHour: true,
  calibrated: false,
}

function metrics(overrides: Partial<BehaviorMetrics> = {}): BehaviorMetrics {
  return {
    timestamp: 0,
    typingSpeed: 0,
    errorRate: 0,
    activeTypingTime: 0,
    pauseDuration: 0,
    keystrokes: 0,
    backspaceRate: 0,
    cursorMovement: 0,
    copyPasteCount: 0,
    fileSwitches: 0,
    testRuns: 0,
    testFailures: 0,
    ...overrides,
  }
}

/** medium 灵敏度 = 0.55 先验，也就是新用户的默认值。 */
function input(overrides: Partial<BehaviorScoringInput> = {}): BehaviorScoringInput {
  return {
    metrics: metrics(),
    neutralBias: 0.55,
    relative: UNCALIBRATED,
    idleDuration: 0,
    sessionMinutes: 5,
    hour: 14,
    ...overrides,
  }
}

describe('scoreBehavior', () => {
  it('reports neutral when nothing is happening', () => {
    expect(scoreBehavior(input()).state).toBe('neutral')
  })

  describe('every state is reachable at the default sensitivity', () => {
    // 每一行都是"最自然的那种情形"，不是为了通过而拼出来的极端参数。
    const cases: Array<[string, Partial<BehaviorScoringInput>]> = [
      ['focused：稳定敲代码，顺手翻几个文件', {
        metrics: metrics({ typingSpeed: 45, fileSwitches: 2 }),
      }],
      ['focused：不打字但在读代码（鼠标刚动过，长时间没敲键）', {
        metrics: metrics({ typingSpeed: 0, pauseDuration: 40_000 }),
        idleDuration: 3_000,
      }],
      ['excited：手速明显高于常人区间', {
        metrics: metrics({ typingSpeed: 95 }),
      }],
      ['flow：持续输出、一个文件不换，正处在 15-60 分钟窗口', {
        metrics: metrics({ typingSpeed: 45, fileSwitches: 0 }),
        sessionMinutes: 30,
      }],
      ['frustrated：退格率极高', {
        metrics: metrics({ typingSpeed: 20, errorRate: 0.8 }),
      }],
      ['stressed：疯狂切文件', {
        metrics: metrics({ typingSpeed: 10, fileSwitches: 9 }),
      }],
      ['tired：深夜 + 连续四小时 + 发呆', {
        metrics: metrics({ typingSpeed: 0, pauseDuration: 60_000 }),
        idleDuration: 90_000,
        sessionMinutes: 240,
        hour: 3,
      }],
      ['bored：两分钟一动不动', {
        metrics: metrics({ typingSpeed: 0, pauseDuration: 30_000 }),
        idleDuration: 180_000,
      }],
    ]

    for (const [name, overrides] of cases) {
      it(name, () => {
        const expected = name.split('：')[0]
        expect(scoreBehavior(input(overrides)).state).toBe(expected)
      })
    }
  })

  it('never lets excited swallow ordinary typing', () => {
    // 这是原来那个 bug 的方向性断言：一般手速是 focused，不是 excited。
    for (const typingSpeed of [15, 25, 35, 45, 55, 65]) {
      const scoring = scoreBehavior(input({ metrics: metrics({ typingSpeed, fileSwitches: 2 }) }))
      expect(scoring.state, `${typingSpeed} WPM`).not.toBe('excited')
    }
  })

  it('keeps focused reachable at every sensitivity', () => {
    // low(0.70) 的先验最高，最容易把某个状态挤成不可达 —— 挤掉的恰好就是 focused。
    for (const neutralBias of [0.4, 0.55, 0.7]) {
      const reading = scoreBehavior(input({
        neutralBias,
        metrics: metrics({ typingSpeed: 0, pauseDuration: 40_000, fileSwitches: 1 }),
        idleDuration: 3_000,
      }))
      expect(reading.state, `neutralBias=${neutralBias}`).toBe('focused')
    }
  })

  it('treats a personal slowdown as frustration rather than speed', () => {
    // 校准过之后判据从绝对值换成 σ：比自己平时慢 2σ + 退格变多 → frustrated。
    const scoring = scoreBehavior(input({
      metrics: metrics({ typingSpeed: 12, errorRate: 0.35 }),
      relative: {
        typingSpeedDeviation: -2,
        backspaceRateDeviation: 1.2,
        fileSwitchDeviation: 0,
        isActiveHour: true,
        calibrated: true,
      },
    }))
    expect(scoring.state).toBe('frustrated')
  })

  it('always reports six factors and a confidence in range', () => {
    // 六个 factor 是固定的（打字/退格/停顿/切换/时长/时段）。confidence 由 factor 数量
    // 和强度算出来，`factors.length / 4` 会被 clamp 到 1，所以下限是 0.4。
    const scoring = scoreBehavior(input({ metrics: metrics({ typingSpeed: 45 }) }))
    expect(scoring.factors).toHaveLength(6)
    expect(scoring.confidence).toBeGreaterThanOrEqual(0.4)
    expect(scoring.confidence).toBeLessThanOrEqual(0.8)
    expect(scoring.intensity).toBeGreaterThan(0)
    expect(scoring.intensity).toBeLessThanOrEqual(1)
  })
})
