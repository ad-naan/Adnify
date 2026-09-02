/**
 * 情绪检测反馈系统
 *
 * 记录用户对情绪判断的反馈（准确/不准确），用于：
 *  1. 持久化存储反馈数据（localStorage）
 *  2. 计算检测准确率
 *  3. 未来用于校准检测引擎权重
 *
 * 隐私模式（`emotionPanelSettings.privacyMode`）下：不再写盘，并且把已经存下来的反馈
 * 一起删掉 —— 只挡新写入的话，旧记录还留在磁盘上，和"不保存行为与学习数据"不符。
 */

import type { EmotionState } from '../types/emotion'
import { isEmotionPrivacyMode, loadEmotionPanelSettings, subscribeEmotionPanelSettings } from './panelSettings'

export interface FeedbackRecord {
  timestamp: number
  detectedState: EmotionState
  feedback: 'accurate' | 'inaccurate'
  /** 用户认为正确的状态（如果反馈不准确） */
  correctedState?: EmotionState
}

const STORAGE_KEY = 'adnify_emotion_feedback'
const MAX_RECORDS = 200

class EmotionFeedbackStore {
  private records: FeedbackRecord[] = []
  private privacyMode = false

  constructor() {
    this.load()
    // 见 `emotionBaseline` 里同一段注释：构造函数里查 privacyMode 只会拿到默认值，
    // 真实值靠 hydrate 之后的这次 notify。
    subscribeEmotionPanelSettings(settings => {
      const wasPrivate = this.privacyMode
      this.privacyMode = settings.privacyMode
      if (settings.privacyMode && !wasPrivate) this.forgetRecords()
    })
    void loadEmotionPanelSettings()
  }

  /** 丢掉全部反馈记录：localStorage 里的和内存里的。 */
  private forgetRecords(): void {
    this.records = []
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }

  /**
   * 记录用户反馈
   */
  recordFeedback(
    detectedState: EmotionState,
    feedback: 'accurate' | 'inaccurate',
    correctedState?: EmotionState,
  ): void {
    if (isEmotionPrivacyMode()) return

    this.records.push({
      timestamp: Date.now(),
      detectedState,
      feedback,
      correctedState,
    })

    // 限制大小
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(-MAX_RECORDS)
    }

    this.save()
  }

  /**
   * 获取检测准确率
   */
  getAccuracy(): { total: number; accurate: number; rate: number } {
    const total = this.records.length
    const accurate = this.records.filter(r => r.feedback === 'accurate').length
    return {
      total,
      accurate,
      rate: total > 0 ? accurate / total : 0,
    }
  }

  /**
   * 获取某个状态的准确率
   */
  getStateAccuracy(state: EmotionState): { total: number; accurate: number; rate: number } {
    const stateRecords = this.records.filter(r => r.detectedState === state)
    const total = stateRecords.length
    const accurate = stateRecords.filter(r => r.feedback === 'accurate').length
    return {
      total,
      accurate,
      rate: total > 0 ? accurate / total : 0,
    }
  }

  /**
   * 获取最近 N 条反馈
   */
  getRecent(count: number = 20): FeedbackRecord[] {
    return this.records.slice(-count)
  }

  /**
   * 获取所有反馈数据（用于导出/分析）
   */
  getAllRecords(): FeedbackRecord[] {
    return [...this.records]
  }

  // ===== 持久化 =====

  private save(): void {
    if (isEmotionPrivacyMode()) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.records))
    } catch {
      // localStorage 满了就算了
    }
  }

  private load(): void {
    try {
      const data = localStorage.getItem(STORAGE_KEY)
      if (data) {
        const parsed = JSON.parse(data)
        this.records = Array.isArray(parsed) ? parsed : []
      }
    } catch {
      this.records = []
    }
  }
}

export const emotionFeedback = new EmotionFeedbackStore()
