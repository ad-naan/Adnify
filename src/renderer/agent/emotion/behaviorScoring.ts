/**
 * 行为层评分：一个窗口的行为指标 + 个人基线偏差 → 一个情绪状态。
 *
 * 单独拆出来是为了能测。原来这 180 行长在 `emotionDetectionEngine` 的一个 private
 * 方法里，中间夹着 `Date.now()`、`loadEmotionPanelSettings()` 和 `emotionBaseline`
 * 单例；想断言"什么输入出什么状态"就得先起一个引擎、伪造 DOM 事件、推进定时器。
 * 结果整个打分核心一直是零覆盖 —— 而它恰好是最容易算错的地方：`focused` 曾经在
 * 默认灵敏度下**数学上不可达**（`excited` 吃同一个信号、系数还更高），
 * 而这种错没有任何测试会红。
 *
 * 这里只做算术。时间、设置、基线一律由调用方作为参数传进来。
 */

import type { BehaviorMetrics, EmotionFactor, EmotionState } from '../types/emotion'

/** `emotionBaseline.getRelativeMetrics()` 的返回形状。 */
export interface BaselineDeviation {
  typingSpeedDeviation: number
  backspaceRateDeviation: number
  fileSwitchDeviation: number
  isActiveHour: boolean
  calibrated: boolean
}

export interface BehaviorScoringInput {
  metrics: BehaviorMetrics
  /**
   * neutral 的先验分。灵敏度就是通过它起作用的：先验越低越容易判出非 neutral 状态。
   * high 0.40 / medium 0.55 / low 0.70。
   */
  neutralBias: number
  relative: BaselineDeviation
  /** 距上一次任意活动（键盘/鼠标/窗口聚焦）的毫秒数。 */
  idleDuration: number
  /** 本次会话已进行的分钟数。 */
  sessionMinutes: number
  /** 本地时钟的小时（0-23），用来判断是否深夜。 */
  hour: number
}

export interface BehaviorScoring {
  state: EmotionState
  intensity: number
  confidence: number
  factors: EmotionFactor[]
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/**
 * 状态平滑。
 *
 * 打分是每个窗口从零重算的，没有任何记忆：一次退格偏多、一次多切了几个文件，
 * 12 秒后状态就翻一次，用户看到的是水獬和状态栏每 12 秒变一下脸。
 *
 * 这里只做一件事：**一个新状态要连续赢两个窗口才生效**。单个窗口的抖动被吸收，
 * 真的变化延迟一个窗口（24 秒）才对外可见 —— 对"你现在是什么情绪"这种量来说，
 * 慢 24 秒远好过每 12 秒抖一下。
 *
 * 没做 EMA 是因为它会连 intensity 一起改掉语义；这里让未确认的窗口整个不算，
 * 对外的 intensity 始终是某个真实窗口算出来的值，而不是几个窗口的混合。
 */
export interface StateSmoothing {
  /** 对外生效的状态 */
  state: EmotionState
  /** 正在等待确认的候选状态 */
  pending: EmotionState | null
  /** 候选已经连续出现了几个窗口 */
  pendingTicks: number
}

/** 新状态要连续赢几个窗口。一个窗口 12 秒，所以 2 = 24 秒。 */
export const STATE_CONFIRM_TICKS = 2

export function smoothState(previous: StateSmoothing, candidate: EmotionState): StateSmoothing {
  if (candidate === previous.state) {
    // 回到当前状态 —— 之前攒的候选作废。
    return { state: candidate, pending: null, pendingTicks: 0 }
  }
  if (candidate === previous.pending) {
    const pendingTicks = previous.pendingTicks + 1
    return pendingTicks >= STATE_CONFIRM_TICKS
      ? { state: candidate, pending: null, pendingTicks: 0 }
      : { state: previous.state, pending: candidate, pendingTicks }
  }
  // 换了个候选，重新数。
  return { state: previous.state, pending: candidate, pendingTicks: 1 }
}

export function normalizeTypingSpeed(wpm: number): number {
  if (wpm < 10) return 0.1
  if (wpm < 20) return 0.2
  if (wpm < 40) return 0.4
  if (wpm < 60) return 0.6
  if (wpm < 80) return 0.8
  return 1.0
}

export function scoreBehavior(input: BehaviorScoringInput): BehaviorScoring {
  const { metrics, neutralBias, relative, idleDuration, sessionMinutes, hour } = input
  const factors: EmotionFactor[] = []

  const scores: Record<EmotionState, number> = {
    focused: 0, frustrated: 0, tired: 0, excited: 0,
    bored: 0, stressed: 0, flow: 0, neutral: neutralBias,
  }

  // === 是在"阅读/思考"还是真的停下了 ===
  // 15 秒内有过任意活动 → 在看代码，不是发呆。
  const recentActivity = idleDuration < 15_000
  const isReading = metrics.typingSpeed < 5 && recentActivity

  // 1. 打字速度 — 有基线就用偏差，否则用绝对值
  const typingSpeedScore = relative.calibrated
    ? clampScore((relative.typingSpeedDeviation + 1) / 2)
    : normalizeTypingSpeed(metrics.typingSpeed)
  factors.push({
    type: 'typing_speed', weight: 0.3, value: typingSpeedScore,
    description: relative.calibrated
      ? `${metrics.typingSpeed.toFixed(0)} WPM (${relative.typingSpeedDeviation > 0 ? '+' : ''}${relative.typingSpeedDeviation.toFixed(1)}σ)`
      : `${metrics.typingSpeed.toFixed(0)} WPM`,
  })

  // 没打字不等于负面 — 阅读时不惩罚 focused/flow。
  //
  // 打字的默认解释是 focused，excited 要"比平时快"才给分。原来两个状态吃同一个信号、
  // excited 的系数还更高（0.9 vs 0.7），所以只要在打字 excited 就恒赢；而 focused
  // 剩下的那条阅读分支上限只有 0.55、越不过 medium 的 0.55 先验 —— 净效果是
  // medium 和 low 灵敏度下 focused 一次都出不来。
  const isUnusuallyFast = relative.calibrated
    ? relative.typingSpeedDeviation > 1
    : metrics.typingSpeed > 70
  if (metrics.typingSpeed > 5) {
    scores.focused += typingSpeedScore * 0.9
    scores.flow += typingSpeedScore * 0.8
    // 平推一个 0.25：只靠系数差会被下面文件切换的 +0.1 抵掉，手速真的异常时也压不过 focused。
    if (isUnusuallyFast) scores.excited += typingSpeedScore * 0.9 + 0.25
  } else if (isReading) {
    // 读代码也是专注。基分刚好越不过先验，要配合下面的停顿分才成立；
    // 不像专注的情况由退格率（→ frustrated）和文件切换（→ stressed）拉回去。
    scores.focused += 0.5
    scores.neutral += 0.1
  }
  scores.tired -= typingSpeedScore * 0.3
  scores.bored -= typingSpeedScore * 0.4

  // 个性化加成：比自己平时慢很多 → 更像 frustrated/tired
  if (relative.calibrated && relative.typingSpeedDeviation < -1.5) {
    scores.frustrated += 0.25
    scores.tired += 0.15
  }

  // 2. 错误率（退格）
  const errorRateScore = relative.calibrated && relative.backspaceRateDeviation > 0.5
    ? clampScore(metrics.errorRate + relative.backspaceRateDeviation * 0.15)
    : metrics.errorRate
  factors.push({
    type: 'error_rate', weight: 0.25, value: errorRateScore,
    description: relative.calibrated
      ? `Backspace: ${(metrics.errorRate * 100).toFixed(0)}% (${relative.backspaceRateDeviation > 0 ? '↑' : '→'})`
      : `Backspace: ${(metrics.errorRate * 100).toFixed(0)}%`,
  })
  scores.frustrated += errorRateScore * 0.8
  scores.tired += errorRateScore * 0.2   // 退格对 tired 影响减弱
  scores.stressed += errorRateScore * 0.5
  scores.focused -= errorRateScore * 0.3
  scores.flow -= errorRateScore * 0.4

  // 3. 停顿 — 只有"真正的发呆"才是 tired 信号。
  //    短停顿（<20s）或刚有过活动 = 在思考/阅读，不算 tired。
  const pauseScore = Math.min(metrics.pauseDuration / 30000, 1)
  factors.push({
    type: 'pause_duration', weight: 0.15, value: pauseScore,
    description: `Pause: ${(metrics.pauseDuration / 1000).toFixed(0)}s`,
  })
  if (isReading) {
    // 盯着同一段代码越久越算专注：0.5 基分 + 满格 0.25 才越过 medium 的 0.55 先验，
    // 短暂抬头不会翻状态。
    scores.focused += pauseScore * 0.25
  } else if (metrics.pauseDuration > 20_000 && !recentActivity) {
    scores.tired += pauseScore * 0.35
    scores.bored += pauseScore * 0.3
  }
  scores.flow -= pauseScore * 0.3  // flow 需要持续输出

  // 4. 文件切换
  const tabSwitchScore = relative.calibrated && relative.fileSwitchDeviation > 1
    ? clampScore(Math.min(metrics.fileSwitches / 3, 1) + relative.fileSwitchDeviation * 0.1)
    : Math.min(metrics.fileSwitches / 3, 1)
  factors.push({
    type: 'tab_switching', weight: 0.15, value: tabSwitchScore,
    description: `Tab switches: ${metrics.fileSwitches}`,
  })
  if (metrics.fileSwitches >= 4) {
    scores.stressed += tabSwitchScore * 0.6   // 频繁切换 → 压力 / 忙碌
    scores.focused -= tabSwitchScore * 0.3
  } else if (metrics.fileSwitches >= 1) {
    scores.focused += 0.1                     // 少量切换 → 正常浏览代码
  }
  scores.flow -= tabSwitchScore * 0.4

  // 5. 工作时长 — 超过 45 分钟才开始累积 tired
  const sessionScore = sessionMinutes > 45
    ? Math.min((sessionMinutes - 45) / 75, 1)  // 45~120 分钟线性增长
    : 0
  factors.push({
    type: 'session_duration', weight: 0.1, value: sessionScore,
    description: `${sessionMinutes.toFixed(0)}min`,
  })
  scores.tired += sessionScore * 0.4
  if (sessionMinutes > 15 && sessionMinutes < 60) {
    scores.flow += 0.15  // 15-60 分钟是 flow 的黄金窗口
  }

  // 6. 时间段
  const isUnusualHour = relative.calibrated ? !relative.isActiveHour : (hour < 6 || hour > 22)
  const timeScore = isUnusualHour ? 0.8 : 0
  factors.push({
    type: 'time_of_day', weight: 0.05, value: timeScore,
    description: relative.calibrated
      ? `${hour}:00 ${isUnusualHour ? '(off-hours)' : ''}`
      : `${hour}:00`,
  })
  scores.tired += timeScore * 0.3  // 只有非常用时段才加

  // 7. 活跃度 — 只有真正完全空闲才判 bored/tired
  if (idleDuration > 120_000) {
    scores.bored += 0.3          // 2 分钟无操作 → 可能走开了
    scores.tired += 0.2
    scores.focused -= 0.2
    scores.flow -= 0.4
  } else if (idleDuration > 60_000) {
    scores.bored += 0.1          // 1 分钟无操作 → 可能在思考
  }

  // 找出最高分。平手时 neutral 赢（比较是严格大于），所以先验同时也是"不确定就别乱报"的闸门。
  let state: EmotionState = 'neutral'
  let maxScore = scores.neutral
  for (const [candidate, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score
      state = candidate as EmotionState
    }
  }

  const intensity = clampScore(maxScore)
  return {
    state,
    intensity,
    confidence: Math.min(factors.length / 4, 1) * (0.4 + intensity * 0.4),
    factors,
  }
}


