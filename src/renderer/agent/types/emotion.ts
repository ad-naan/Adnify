/**
 * 情绪感知环境类型定义
 */

import type { TranslationKey } from '@shared/i18n'

/** 检测到的开发者情绪状态 */
export type EmotionState = 
  | 'focused'      // 专注 - 高效编码中
  | 'frustrated'   // 沮丧 - 连续报错/卡住
  | 'tired'        // 疲劳 - 长时间工作
  | 'excited'      // 兴奋 - 快速编码/新想法
  | 'bored'        // 无聊 - 重复性工作
  | 'stressed'     // 压力 - 紧急任务/多线程工作
  | 'flow'         // 心流 - 深度沉浸状态
  | 'neutral'      // 中性 - 正常工作

/** 情绪强度 0-1 */
export type EmotionIntensity = number

/** 情绪检测结果 */
export interface EmotionDetection {
  state: EmotionState
  intensity: EmotionIntensity
  confidence: number  // AI 对检测结果的置信度
  triggeredAt: number
  duration: number    // 该状态持续时长(ms)
  factors: EmotionFactor[]
  context?: CodeContext  // 检测时的代码上下文
  /**
   * 基于当前状态的建议，存 locale 键而不是句子。
   *
   * 检测跑在渲染进程的服务层，那里没有 `language`；早先直接 push 中文句子，
   * 英文界面的状态栏气泡里就露出一句中文。翻译在 `EmotionStatusIndicator` 做。
   */
  suggestions?: TranslationKey[]
  similarPatterns?: {  // 相似的历史模式
    timestamp: number
    state: EmotionState
    outcome: 'positive' | 'negative' | 'neutral'
  }[]
}

/**
 * 影响情绪的因素。
 *
 * 只是"给人看的解释"，不参与打分 —— 曾经还有一个 `weight` 字段（0.3 / 0.25 / 0.15 …），
 * 从来没有被乘进 `scores`：真正的系数是 `behaviorScoring.ts` 里另一套内联字面量
 * （0.7 / 0.9 / 0.8 …）。两套互不同步的魔数放在一起，改 weight 不影响任何判定，
 * 而读代码的人会以为改了。2026-09-02 删掉，系数只保留生效的那一套。
 */
export interface EmotionFactor {
  type: EmotionFactorType
  value: number       // 具体数值
  description: string
}

export type EmotionFactorType =
  | 'typing_speed'       // 打字速度变化
  | 'error_rate'         // 错误率
  | 'pause_duration'     // 停顿时间
  | 'code_complexity'    // 当前代码复杂度
  | 'time_of_day'        // 时间段
  | 'session_duration'   // 连续工作时长
  | 'tab_switching'      // 标签切换频率
  | 'undo_redo_rate'     // 撤销/重做频率
  | 'test_failure_rate'  // 测试失败率
  | 'save_frequency'     // 保存频率
  | 'ai_interaction_pattern'  // AI交互模式（频繁提问=困惑，快速接受=流畅）
  | 'code_change_pattern'     // 代码变更模式（大重构=压力，小优化=专注）
  | 'git_activity'            // Git活动（频繁提交=兴奋，无提交=卡住）
  | 'error_context'           // 错误上下文（语法错误=沮丧，逻辑错误=思考）
  | 'file_type_pattern'        // 文件类型模式（测试文件=自信，配置文件=谨慎）
  | 'search_pattern'           // 搜索模式（频繁搜索=困惑，少搜索=熟悉）

/** 环境适配配置 */
/**
 * 按情绪调整环境。
 *
 * 只剩 `sound` 和 `break` 两组 —— `theme` / `ui` / `ai` 三组在 2026-09-02 删掉了，
 * 理由写在 `emotionAdapter.ts` 的 `DEFAULT_ADAPTATIONS` 上面：前两组写的 CSS 自定义
 * 属性全仓库没人读，第三组一次都没被读过。
 */
export interface EnvironmentAdaptation {
  sound: {
    enabled: boolean
    volume: number
    type?: 'focus' | 'relax' | 'energize' | 'none'
  }
  break: {
    suggestBreak: boolean
    breakInterval: number  // 建议休息间隔(ms)
    microBreaks: boolean   // 微休息（20秒眼部放松）
  }
}

export interface EmotionFeedbackAction {
  id: string
  labelKey: TranslationKey
  asset?: import('@/renderer/components/brand/otterAssets').OtterAssetKey
  actionType?: string
}

export type EmotionFeedbackType =
  | 'encouragement'
  | 'reassurance'
  | 'focus_hint'
  | 'frustration_support'
  | 'fatigue_warning'
  | 'break_micro'
  | 'break_suggested'
  | 'celebration'

export interface EmotionFeedbackPayload {
  id: string
  type: EmotionFeedbackType
  priority: number
  emotionState: EmotionState
  /** 正文的 locale 键。适配器是纯逻辑层，拿不到 `language`，句子由消费它的组件渲染。 */
  messageKey: TranslationKey
  /** 状态栏那种窄槽位用的短文案键，缺省就退回 `messageKey`。 */
  shortMessageKey?: TranslationKey
  actions?: EmotionFeedbackAction[]
  createdAt: number
  expiresAt?: number
  cooldownKey?: string
  sourceRule?: string
  dismissible?: boolean
  /**
   * 允许在哪些通道上显示。
   *
   * 曾经还有 `'editorBar'`，但 `EmotionEditorBar` 从来没有被挂载过（159 行、29 个提交、
   * 零 import），2026-09-02 连组件带这个取值一起删了。留着单成员联合是因为
   * `EmotionStatusIndicator` 在读它：没带 hint 的 payload 不该显示。
   */
  channelHints?: Array<'statusBar'>
  showFeedback?: boolean
}

export interface EmotionCompanionState {
  currentFeedback: EmotionFeedbackPayload | null
  queue: EmotionFeedbackPayload[]
  lastShownAtByType: Partial<Record<EmotionFeedbackType, number>>
  snoozedUntil?: number
  dismissedIds: string[]
  sessionMuted: boolean
  companionEnabled: boolean
}

/** 情绪历史记录 */
export interface EmotionHistory {
  timestamp: number
  state: EmotionState
  intensity: number
  project: string
  file: string
}

/** 上下文信息 */
export interface CodeContext {
  currentFile: string
  fileType: string           // 'ts', 'tsx', 'js', 'test', 'config', etc.
  projectType: string        // 'react', 'node', 'python', etc.
  recentFiles: string[]      // 最近打开的文件
  codeComplexity: number     // 代码复杂度评分
  hasErrors: boolean         // 当前是否有错误
  errorType?: 'syntax' | 'type' | 'runtime' | 'test'
  gitStatus?: 'clean' | 'modified' | 'conflict'
  recentCommits: number      // 最近1小时的提交数
  searchQueries: number       // 最近搜索次数
  aiInteractions: {
    count: number            // AI交互次数
    avgResponseTime: number  // 平均响应时间
    rejectionRate: number    // 拒绝AI建议的比例
    questionComplexity: 'simple' | 'medium' | 'complex'
  }
}

/** 实时行为指标 */
export interface BehaviorMetrics {
  timestamp: number
  typingSpeed: number        // WPM (words per minute)
  errorRate: number          // 0-1
  activeTypingTime: number   // 连续打字时长(ms)
  pauseDuration: number      // 当前停顿时长(ms)
  keystrokes: number         // 按键次数
  /** 退格/删除次数。是**计数**不是比率 —— 比率在 `errorRate`（退格 / 总按键）。 */
  backspaces: number
  cursorMovement: number     // 光标移动次数
  copyPasteCount: number     // 复制粘贴次数
  fileSwitches: number       // 文件切换次数
  testRuns: number           // 测试运行次数
  testFailures: number       // 测试失败次数
  context?: CodeContext       // 代码上下文（可选，需要时获取）
}
