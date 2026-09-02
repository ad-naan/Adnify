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
import {
  aggregateWindow,
  focusMinutes,
  scoreBehavior,
  smoothState,
  STATE_CONFIRM_TICKS,
  type BaselineDeviation,
  type BehaviorScoringInput,
  type StateSmoothing,
} from '@renderer/agent/emotion/behaviorScoring'
import type { BehaviorMetrics, EmotionState } from '@renderer/agent/types/emotion'

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
    backspaces: 0,
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

describe('smoothState', () => {
  const fresh = (state: EmotionState = 'neutral'): StateSmoothing =>
    ({ state, pending: null, pendingTicks: 0 })

  /** 把一串候选依次喂进去，返回每一步对外生效的状态。 */
  const run = (start: StateSmoothing, candidates: EmotionState[]): EmotionState[] => {
    let current = start
    return candidates.map(candidate => {
      current = smoothState(current, candidate)
      return current.state
    })
  }

  it('absorbs a single-window blip', () => {
    // 这就是平滑存在的理由：一次退格偏多不该让界面翻脸。
    expect(run(fresh('focused'), ['frustrated', 'focused'])).toEqual(['focused', 'focused'])
  })

  it('commits a change once it wins two windows in a row', () => {
    expect(run(fresh('focused'), ['frustrated', 'frustrated'])).toEqual(['focused', 'frustrated'])
    expect(STATE_CONFIRM_TICKS).toBe(2)
  })

  it('restarts counting when the candidate itself keeps changing', () => {
    // 三个窗口三个不同候选 —— 没有任何一个连赢两次，所以对外一直不动。
    expect(run(fresh('focused'), ['frustrated', 'tired', 'bored'])).toEqual(
      ['focused', 'focused', 'focused'],
    )
  })

  it('drops the pending candidate when the current state comes back', () => {
    const afterBlip = smoothState(fresh('focused'), 'tired')
    expect(afterBlip.pending).toBe('tired')
    const backHome = smoothState(afterBlip, 'focused')
    expect(backHome).toEqual({ state: 'focused', pending: null, pendingTicks: 0 })
    // 回来之后再看到 tired，要重新数两次，不能接着上一轮的计数直接生效。
    expect(run(backHome, ['tired'])).toEqual(['focused'])
  })

  it('keeps reporting the same state when nothing changes', () => {
    expect(run(fresh('flow'), ['flow', 'flow', 'flow'])).toEqual(['flow', 'flow', 'flow'])
  })
})

describe('aggregateWindow', () => {
  const SAMPLE = 4_000

  /** 一个快照 = 这一段采样间隔里累积的计数（flush 之后计数器清零）。 */
  const snapshot = (keystrokes: number, backspaces = 0): BehaviorMetrics =>
    metrics({ keystrokes, backspaces, activeTypingTime: SAMPLE })

  it('measures the window as N intervals, not N-1', () => {
    // 3 个快照 × 4 秒 = 12 秒 = 0.2 分钟；60 次按键 = 12 个"词"（5 字符一个）→ 60 WPM。
    // 旧算法用 last-first = 8 秒做除数，同样的输入会报 90 WPM —— 虚高正好 1.5 倍。
    const window = aggregateWindow([snapshot(20), snapshot(20), snapshot(20)], SAMPLE)
    expect(window.typingSpeed).toBeCloseTo(60, 5)
  })

  it('does not blow up on a single snapshot', () => {
    // 单个快照时旧算法退化成 `SAMPLE_INTERVAL`，新算法就是 1 × SAMPLE，结果一致。
    expect(aggregateWindow([snapshot(20)], SAMPLE).typingSpeed).toBeCloseTo(60, 5)
  })

  it('turns backspace counts into a rate over the same window', () => {
    const window = aggregateWindow([snapshot(30, 3), snapshot(30, 9)], SAMPLE)
    expect(window.keystrokes).toBe(60)
    expect(window.backspaces).toBe(12)
    expect(window.errorRate).toBeCloseTo(0.2, 5)
  })

  it('sums typing time instead of summing timestamps', () => {
    // `activeTypingTime` 以前存的是 `Date.now()`，求和之后是个天文数字。
    const window = aggregateWindow([snapshot(10), snapshot(10), snapshot(10)], SAMPLE)
    expect(window.activeTypingTime).toBe(3 * SAMPLE)
  })

  it('takes the latest pause rather than adding them up', () => {
    const window = aggregateWindow(
      [metrics({ pauseDuration: 1_000 }), metrics({ pauseDuration: 9_000 })],
      SAMPLE,
    )
    expect(window.pauseDuration).toBe(9_000)
  })
})

describe('focusMinutes', () => {
  const GAP_CAP = 60_000
  const at = (minute: number, state: EmotionState) =>
    ({ timestamp: minute * 60_000, state, intensity: 0.6, project: '', file: '' })

  it('credits the real gap between records, not a fixed constant per record', () => {
    // 三条记录，间隔 24 秒 —— 持续专注时引擎就是每 24 秒补一条。
    // 旧算法按"条数 × 12 秒"算成 0.6 分钟，实际是 0.8 分钟（24+24 秒 + 尾巴）。
    const history = [
      { timestamp: 0, state: 'focused' as EmotionState, intensity: 0.6, project: '', file: '' },
      { timestamp: 24_000, state: 'focused' as EmotionState, intensity: 0.6, project: '', file: '' },
      { timestamp: 48_000, state: 'focused' as EmotionState, intensity: 0.6, project: '', file: '' },
    ]
    expect(focusMinutes(history, 60_000, GAP_CAP)).toBeCloseTo(1, 5)
  })

  it('ignores stretches spent in other states', () => {
    const history = [at(0, 'focused'), at(1, 'frustrated'), at(2, 'flow')]
    // focused 0→1 分钟算 1 分钟；frustrated 那段不算；flow 从 2 分钟到 now(3) 算 1 分钟。
    expect(focusMinutes(history, 3 * 60_000, GAP_CAP)).toBeCloseTo(2, 5)
  })

  it('caps a gap so an overnight shutdown is not counted as focus', () => {
    // 一条 focused 之后八小时没有任何记录 —— 不能算成专注了八小时。
    const history = [at(0, 'focused')]
    expect(focusMinutes(history, 8 * 60 * 60_000, GAP_CAP)).toBeCloseTo(1, 5)
  })

  it('is zero for an empty history', () => {
    expect(focusMinutes([], Date.now(), GAP_CAP)).toBe(0)
  })
})
