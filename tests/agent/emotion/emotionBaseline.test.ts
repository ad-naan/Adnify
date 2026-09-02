/**
 * 个性化基线：加载、校准判定、以及隐私模式下的清除。
 *
 * 这个文件是这个子系统第一份行为测试。选它做起点是因为它纯：算术是确定性的，
 * 只依赖 localStorage 和面板设置两个已经被 mock 的东西，没有 DOM、没有计时器、
 * 没有 AudioContext。
 *
 * 每个用例都自己 `vi.resetModules()` 再 import —— `emotionBaseline` 是模块级单例，
 * 构造函数里就读了 localStorage 并挂上设置订阅，共用一个实例会让用例互相污染
 * （现有的 `emotionAdapter.test.ts` 正是共用单例、且没有 beforeEach 重置）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const BASELINE_KEY = 'adnify_emotion_baseline'
/** `LEARNING_SAMPLES` 是 50；给 60 条确保跨过门槛。 */
const CALIBRATED_SAMPLES = 60

function seedStoredBaseline(sampleCount = CALIBRATED_SAMPLES): void {
  const samples = Array.from({ length: sampleCount }, (_, index) => ({
    timestamp: Date.now() - index * 1_000,
    typingSpeed: 40,
    backspaceRate: 0.1,
    fileSwitchesPerMin: 1,
    hour: 10,
  }))
  localStorage.setItem(BASELINE_KEY, JSON.stringify({
    samples,
    avgTypingSpeed: 40,
    avgBackspaceRate: 0.1,
    avgFileSwitchRate: 1,
    stdTypingSpeed: 5,
    preferredHours: [10],
  }))
}

/** 重新 import 一整套，拿到干净的单例。panelSettings 要和 baseline 出自同一次 reset。 */
async function freshModules() {
  vi.resetModules()
  const panelSettings = await import('@renderer/agent/emotion/panelSettings')
  const { emotionBaseline } = await import('@renderer/agent/emotion/emotionBaseline')
  return { ...panelSettings, emotionBaseline }
}

describe('emotionBaseline', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('loads a stored baseline and reports itself calibrated', async () => {
    seedStoredBaseline()
    const { emotionBaseline } = await freshModules()

    expect(emotionBaseline.isCalibrated()).toBe(true)
    expect(emotionBaseline.getStats().sampleCount).toBe(CALIBRATED_SAMPLES)
  })

  it('reports no deviation at all until it has enough samples', async () => {
    seedStoredBaseline(10)
    const { emotionBaseline } = await freshModules()

    // 未校准时必须回全 0 + calibrated:false —— 引擎用 `relative.calibrated` 决定
    // 走绝对值还是走偏差，这里给个"看起来像真的"的偏差会让打分静默走错分支。
    expect(emotionBaseline.getRelativeMetrics(120, 0.9, 9)).toEqual({
      typingSpeedDeviation: 0,
      backspaceRateDeviation: 0,
      fileSwitchDeviation: 0,
      isActiveHour: true,
      calibrated: false,
    })
  })

  it('turns a slower-than-usual speed into a negative sigma', async () => {
    seedStoredBaseline()
    const { emotionBaseline } = await freshModules()

    // 存的基线是 40 WPM / σ=5，所以 25 WPM 是 -3σ（clamp 到 -3）、40 是 0、50 是 +2。
    expect(emotionBaseline.getRelativeMetrics(25, 0.1, 1).typingSpeedDeviation).toBe(-3)
    expect(emotionBaseline.getRelativeMetrics(40, 0.1, 1).typingSpeedDeviation).toBe(0)
    expect(emotionBaseline.getRelativeMetrics(50, 0.1, 1).typingSpeedDeviation).toBe(2)
  })

  it('deletes the stored baseline when privacy mode turns on', async () => {
    seedStoredBaseline()
    const { emotionBaseline, updateEmotionPanelSettings } = await freshModules()
    expect(emotionBaseline.isCalibrated()).toBe(true)

    updateEmotionPanelSettings({ privacyMode: true })

    // 两半都要清：磁盘上的记录，和已经读进内存、仍在参与校准的那份。
    expect(localStorage.getItem(BASELINE_KEY)).toBeNull()
    expect(emotionBaseline.isCalibrated()).toBe(false)
  })

  it('keeps the in-memory baseline when an unrelated setting changes while private', async () => {
    const { emotionBaseline, updateEmotionPanelSettings } = await freshModules()
    updateEmotionPanelSettings({ privacyMode: true })
    for (let i = 0; i < CALIBRATED_SAMPLES; i++) emotionBaseline.recordSample(40, 0.1, 1)
    expect(emotionBaseline.isCalibrated()).toBe(true)

    // 清除只在 关→开 那一次发生。否则拨一下光效开关就会把本次会话学到的东西也抹掉，
    // 而订阅回调对每个设置变更都会触发。
    updateEmotionPanelSettings({ ambientGlow: false })

    expect(emotionBaseline.isCalibrated()).toBe(true)
  })

  it('never writes to disk while privacy mode is on', async () => {
    const { emotionBaseline, updateEmotionPanelSettings } = await freshModules()
    updateEmotionPanelSettings({ privacyMode: true })

    for (let i = 0; i < CALIBRATED_SAMPLES; i++) emotionBaseline.recordSample(40, 0.1, 1)

    expect(localStorage.getItem(BASELINE_KEY)).toBeNull()
  })
})
