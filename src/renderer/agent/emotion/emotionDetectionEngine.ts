/**
 * 情绪检测引擎 v3
 *
 * 两层检测架构：
 *  1. 行为指标（键盘/鼠标/停顿）+ 个性化基线 → 基础评分
 *  2. 真实上下文（诊断/Git/AI 对话）→ 增强评分 + 智能建议
 */

import { logger } from '@utils/Logger'
import { EventBus } from '../core/EventBus'
import { emotionContextAnalyzer } from './emotionContextAnalyzer'
import { emotionBaseline } from './emotionBaseline'
import { scoreBehavior } from './behaviorScoring'
import { loadEmotionPanelSettings } from './panelSettings'
import type {
  EmotionDetection,
  EmotionFactor,
  BehaviorMetrics,
  EmotionHistory,
} from '../types/emotion'

// 检测窗口配置
const DETECTION_WINDOW = 12000   // 12秒分析窗口（比15s更快响应）
const SAMPLE_INTERVAL = 4000     // 每4秒采样一次指标
const METRICS_BUFFER_SIZE = 100
const HISTORY_LIMIT = 1440       // 保存24小时的历史

class EmotionDetectionEngine {
  private metricsBuffer: BehaviorMetrics[] = []
  private history: EmotionHistory[] = []
  private currentState: EmotionDetection | null = null
  private stateStartTime = Date.now()
  private sessionStartTime = Date.now()
  private _lastActivityTime = Date.now()

  // 定时器
  private typingTimer: NodeJS.Timeout | null = null
  private pauseTimer: NodeJS.Timeout | null = null
  private analysisTimer: NodeJS.Timeout | null = null
  private samplingTimer: NodeJS.Timeout | null = null

  // 运行状态
  private isRunning = false
  private isTyping = false
  private currentFile = ''
  private currentProject = ''

  /** 处于 focused/flow 时未广播的周期计数，用于定期写入 history 以让 Focus Time 累积 */
  private _focusRecordTicker = 0

  // 实时计数器（在采样间隔内累积，每次采样时写入指标块）
  private liveCounters = {
    keystrokes: 0,
    backspaces: 0,
    cursorMoves: 0,
    copyPastes: 0,
    fileSwitches: 0,
    testRuns: 0,
    testFailures: 0,
  }

  // 事件监听器引用
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null
  private mousemoveHandler: (() => void) | null = null
  private lastMouseActivityAt = 0
  private blurHandler: (() => void) | null = null
  private focusHandler: (() => void) | null = null

  /**
   * 启动检测引擎（防重入）
   */
  start(): void {
    if (this.isRunning) return
    this.isRunning = true

    // 初始化上下文分析器（订阅 Store / EventBus）
    emotionContextAnalyzer.init()

    this.setupEventListeners()
    this.startSampling()
    this.startPeriodicAnalysis()

    // 立即发射初始状态，不让 UI 等
    this.emitInitialState()

    logger.agent.info('[EmotionEngine] Started (v3 — real data + sensitivity)')
  }

  /**
   * 停止检测引擎
   */
  stop(): void {
    if (!this.isRunning) return
    this.isRunning = false
    this.cleanup()
    emotionContextAnalyzer.destroy()
    logger.agent.info('[EmotionEngine] Stopped')
  }

  // ===== 记录方法（外部调用） =====

  recordKeystroke(key: string): void {
    this._lastActivityTime = Date.now()
    this.liveCounters.keystrokes++
    if (key === 'Backspace' || key === 'Delete') {
      this.liveCounters.backspaces++
    }
    this.handleTypingStart()
  }

  recordCursorMovement(): void {
    this.liveCounters.cursorMoves++
  }

  recordCopyPaste(): void {
    this.liveCounters.copyPastes++
  }

  recordFileSwitch(filePath: string): void {
    this.currentFile = filePath
    this.liveCounters.fileSwitches++
  }

  recordTestRun(failed: number, _total: number): void {
    this.liveCounters.testRuns++
    this.liveCounters.testFailures += failed
  }

  setProject(name: string): void {
    this.currentProject = name
  }

  recordSave(): void {
    // 未来扩展
  }

  recordError(): void {
    // 未来扩展
  }

  getCurrentState(): EmotionDetection | null {
    return this.currentState
  }

  getHistory(duration: number = 24 * 60 * 60 * 1000): EmotionHistory[] {
    const cutoff = Date.now() - duration
    return this.history.filter(h => h.timestamp > cutoff)
  }

  getProductivityReport(): {
    focusTime: number
    flowSessions: number
    frustrationEpisodes: number
    breakRecommendations: number
    mostProductiveHour: number
  } {
    const dayHistory = this.getHistory(24 * 60 * 60 * 1000)

    // 计算历史记录中的 Focus Time（每个记录代表一个检测窗口，约12秒）
    const historyFocusTime = dayHistory.filter(h =>
      h.state === 'focused' || h.state === 'flow'
    ).length * (DETECTION_WINDOW / 1000 / 60)

    // 如果当前状态是 focused 或 flow，加上当前状态的持续时间
    // 历史记录只在状态变化或强度变化较大时记录，所以需要加上当前状态的持续时间
    let currentStateFocusTime = 0
    if (this.currentState && (this.currentState.state === 'focused' || this.currentState.state === 'flow')) {
      // 找到历史记录中最后一条 focused/flow 记录的时间戳
      const lastFocusRecord = dayHistory
        .filter(h => h.state === 'focused' || h.state === 'flow')
        .sort((a, b) => b.timestamp - a.timestamp)[0]
      
      // 如果最后一条记录的时间戳早于 stateStartTime，说明状态已经变化了，从 stateStartTime 开始计算
      // 否则，从最后一条记录的时间戳开始计算（避免重复计算）
      const startTime = lastFocusRecord && lastFocusRecord.timestamp >= this.stateStartTime
        ? lastFocusRecord.timestamp
        : this.stateStartTime
      
      const currentStateDuration = Date.now() - startTime
      // 只计算超过一个检测窗口的时间（避免与历史记录重复）
      const extraTime = Math.max(0, currentStateDuration - DETECTION_WINDOW)
      currentStateFocusTime = extraTime / 1000 / 60 // 转换为分钟
    }

    const focusTime = historyFocusTime + currentStateFocusTime

    let flowSessions = 0
    let inFlowSession = false
    for (const h of dayHistory) {
      if (h.state === 'flow' && !inFlowSession) {
        flowSessions++
        inFlowSession = true
      } else if (h.state !== 'flow') {
        inFlowSession = false
      }
    }

    const frustrationEpisodes = dayHistory.filter(h => h.state === 'frustrated').length
    const breakRecommendations = dayHistory.filter(h => h.state === 'tired').length

    const hourlyProductivity = new Array(24).fill(0)
    for (const h of dayHistory) {
      if (h.state === 'focused' || h.state === 'flow') {
        const hour = new Date(h.timestamp).getHours()
        hourlyProductivity[hour]++
      }
    }
    const maxCount = Math.max(...hourlyProductivity)
    const mostProductiveHour = maxCount > 0 ? hourlyProductivity.indexOf(maxCount) : -1

    return { focusTime, flowSessions, frustrationEpisodes, breakRecommendations, mostProductiveHour }
  }

  // ===== 私有方法 =====

  private setupEventListeners(): void {
    this.keydownHandler = (e: KeyboardEvent) => this.recordKeystroke(e.key)
    this.mousemoveHandler = () => {
      const now = Date.now()
      if (now - this.lastMouseActivityAt < 1000) return
      this.lastMouseActivityAt = now
      this._lastActivityTime = now
    }
    this.blurHandler = () => this.handlePause()
    this.focusHandler = () => { this._lastActivityTime = Date.now() }

    window.addEventListener('keydown', this.keydownHandler)
    window.addEventListener('mousemove', this.mousemoveHandler)
    window.addEventListener('blur', this.blurHandler)
    window.addEventListener('focus', this.focusHandler)
  }

  /**
   * 定期采样（每4秒创建一个指标快照）
   */
  private startSampling(): void {
    this.flushCountersToMetrics()

    this.samplingTimer = setInterval(() => {
      this.flushCountersToMetrics()
    }, SAMPLE_INTERVAL)
  }

  /**
   * 把实时计数器写入一个指标快照
   */
  private flushCountersToMetrics(): void {
    const metrics: BehaviorMetrics = {
      timestamp: Date.now(),
      typingSpeed: 0,
      errorRate: 0,
      activeTypingTime: this.isTyping ? Date.now() : 0,
      pauseDuration: this.getCurrentPauseDuration(),
      keystrokes: this.liveCounters.keystrokes,
      backspaceRate: this.liveCounters.backspaces,
      cursorMovement: this.liveCounters.cursorMoves,
      copyPasteCount: this.liveCounters.copyPastes,
      fileSwitches: this.liveCounters.fileSwitches,
      testRuns: this.liveCounters.testRuns,
      testFailures: this.liveCounters.testFailures,
    }

    this.metricsBuffer.push(metrics)
    if (this.metricsBuffer.length > METRICS_BUFFER_SIZE) {
      this.metricsBuffer.shift()
    }

    // 重置计数器
    this.liveCounters = {
      keystrokes: 0,
      backspaces: 0,
      cursorMoves: 0,
      copyPastes: 0,
      fileSwitches: 0,
      testRuns: 0,
      testFailures: 0,
    }
  }

  private pauseStartTime: number | null = null

  private getCurrentPauseDuration(): number {
    return this.pauseStartTime ? Date.now() - this.pauseStartTime : 0
  }

  private handleTypingStart(): void {
    this.isTyping = true
    this.pauseStartTime = null

    if (this.typingTimer) clearTimeout(this.typingTimer)

    this.typingTimer = setTimeout(() => {
      this.isTyping = false
      this.handlePause()
    }, 2000)
  }

  private handlePause(): void {
    this.pauseStartTime = Date.now()
  }

  private startPeriodicAnalysis(): void {
    if (this.analysisTimer) clearInterval(this.analysisTimer)

    this.analysisTimer = setInterval(() => {
      this.analyzeAndDetect()
    }, DETECTION_WINDOW)
  }

  /**
   * 启动时立即发射初始状态
   */
  private emitInitialState(): void {
    const detection: EmotionDetection = {
      state: 'neutral',
      intensity: 0.5,
      confidence: 0.3,
      triggeredAt: Date.now(),
      duration: 0,
      factors: [{
        type: 'session_duration',
        weight: 1,
        value: 0,
        description: 'Session just started',
      }],
      suggestions: ['emotion.suggestion.welcomeBack'],
    }

    this.currentState = detection
    this.stateStartTime = Date.now()
    this.recordHistory(detection)

    EventBus.emit({ type: 'emotion:changed', emotion: detection })
  }

  /**
   * 核心分析流程 — 两层架构：行为指标 → 上下文增强
   */
  private analyzeAndDetect(): void {
    const windowStart = Date.now() - DETECTION_WINDOW
    const recentMetrics = this.metricsBuffer.filter(m => m.timestamp > windowStart)

    if (recentMetrics.length === 0) return

    const aggregated = this.aggregateMetrics(recentMetrics)

    // —— 第 1 层：基于行为指标的基础检测 ——
    const baseDetection = this.detectEmotionFromBehavior(aggregated)

    // —— 第 2 层：从上下文分析器获取真实数据，增强检测 ——
    const context = emotionContextAnalyzer.analyzeContext()
    const enhanced = emotionContextAnalyzer.enhanceEmotionDetection(
      baseDetection.state,
      baseDetection.intensity,
      context
    )

    // —— 合并因子 ——
    const contextFactors = this.buildContextFactors(context)
    const allFactors = [...baseDetection.factors, ...contextFactors]

    const detection: EmotionDetection = {
      state: enhanced.state,
      intensity: enhanced.intensity,
      confidence: enhanced.confidence,
      triggeredAt: Date.now(),
      duration: Date.now() - this.stateStartTime,
      factors: allFactors,
      context: context || undefined,
      suggestions: enhanced.suggestions.length > 0 ? enhanced.suggestions : undefined,
    }

    // 检查状态是否真正变化（用于更新 stateStartTime）
    const stateChanged = !this.currentState || this.currentState.state !== detection.state
    const shouldBroadcast = this.shouldNotifyStateChange(detection)
    
    // 如果状态类型变化，更新 stateStartTime
    if (stateChanged) {
      this.stateStartTime = Date.now()
    }
    
    // 始终更新 currentState
    this.currentState = detection

    if (shouldBroadcast) {
      this.recordHistory(detection)
      this._focusRecordTicker = 0
      EventBus.emit({ type: 'emotion:changed', emotion: detection })

      logger.agent.info('[EmotionEngine] State:', detection.state,
        `intensity=${detection.intensity.toFixed(2)}`,
        `confidence=${detection.confidence.toFixed(2)}`,
        `factors=${allFactors.length}`,
        `ctx=${context ? 'yes' : 'no'}`,
      )
    } else if (detection.state === 'focused' || detection.state === 'flow') {
      // 持续处于专注/心流时也定期写入 history，否则 Focus Time 只依赖 currentStateFocusTime 容易“没反应”
      this._focusRecordTicker++
      if (this._focusRecordTicker >= 2) {
        this._focusRecordTicker = 0
        this.recordHistory(detection)
      }
    } else {
      this._focusRecordTicker = 0
    }
  }

  /**
   * 根据真实上下文生成额外的 EmotionFactor
   */
  private buildContextFactors(context: ReturnType<typeof emotionContextAnalyzer.analyzeContext>): EmotionFactor[] {
    if (!context) return []
    const factors: EmotionFactor[] = []

    // 诊断错误因子
    if (context.hasErrors) {
      const diagErrors = emotionContextAnalyzer.getRecentDiagnosticErrors(15 * 60 * 1000)
      factors.push({
        type: 'error_context',
        weight: 0.3,
        value: Math.min(diagErrors.errors / 5, 1),
        description: `${diagErrors.errors} errors, ${diagErrors.warnings} warnings (LSP)`,
      })
    }

    // AI 交互因子
    if (context.aiInteractions.count > 0) {
      factors.push({
        type: 'ai_interaction_pattern',
        weight: 0.2,
        value: Math.min(context.aiInteractions.count / 10, 1),
        description: `${context.aiInteractions.count} AI interactions, avg ${(context.aiInteractions.avgResponseTime / 1000).toFixed(1)}s`,
      })
    }

    // Git 状态因子
    if (context.gitStatus && context.gitStatus !== 'clean') {
      factors.push({
        type: 'git_activity',
        weight: context.gitStatus === 'conflict' ? 0.35 : 0.15,
        value: context.gitStatus === 'conflict' ? 1.0 : 0.5,
        description: `Git: ${context.gitStatus}`,
      })
    }

    // 文件类型因子
    factors.push({
      type: 'file_type_pattern',
      weight: 0.1,
      value: context.fileType === 'test' ? 0.7 : context.fileType === 'config' ? 0.5 : 0.3,
      description: `File: ${context.fileType} (${context.currentFile.split('/').pop()})`,
    })

    // 文件切换/搜索因子
    if (context.searchQueries > 3) {
      factors.push({
        type: 'search_pattern',
        weight: 0.15,
        value: Math.min(context.searchQueries / 10, 1),
        description: `${context.searchQueries} file switches (15min)`,
      })
    }

    // 代码复杂度因子
    if (context.codeComplexity > 0.3) {
      factors.push({
        type: 'code_complexity',
        weight: 0.15,
        value: context.codeComplexity,
        description: `Complexity: ${(context.codeComplexity * 100).toFixed(0)}%`,
      })
    }

    return factors
  }

  private aggregateMetrics(metrics: BehaviorMetrics[]): BehaviorMetrics {
    if (metrics.length === 0) {
      return this.createEmptyMetrics()
    }

    const sum = (key: keyof BehaviorMetrics) =>
      metrics.reduce((acc, m) => acc + (m[key] as number), 0)

    const totalKeystrokes = sum('keystrokes')
    const timeSpanMs = metrics.length > 1
      ? metrics[metrics.length - 1].timestamp - metrics[0].timestamp
      : SAMPLE_INTERVAL
    const timeSpanMin = Math.max(timeSpanMs / 1000 / 60, 0.01)
    const typingSpeed = (totalKeystrokes / 5) / timeSpanMin

    const totalBackspaces = sum('backspaceRate')
    const errorRate = totalKeystrokes > 0 ? totalBackspaces / totalKeystrokes : 0

    const lastPause = metrics[metrics.length - 1].pauseDuration

    return {
      timestamp: Date.now(),
      typingSpeed: Math.min(typingSpeed, 150),
      errorRate,
      activeTypingTime: sum('activeTypingTime'),
      pauseDuration: lastPause,
      keystrokes: totalKeystrokes,
      backspaceRate: totalBackspaces,
      cursorMovement: sum('cursorMovement'),
      copyPasteCount: sum('copyPasteCount'),
      fileSwitches: sum('fileSwitches'),
      testRuns: sum('testRuns'),
      testFailures: sum('testFailures'),
    }
  }

  private createEmptyMetrics(): BehaviorMetrics {
    return {
      timestamp: Date.now(), typingSpeed: 0, errorRate: 0,
      activeTypingTime: 0, pauseDuration: 0, keystrokes: 0,
      backspaceRate: 0, cursorMovement: 0, copyPasteCount: 0,
      fileSwitches: 0, testRuns: 0, testFailures: 0,
    }
  }

  /**
   * 基于行为指标的基础情绪检测
   */
  private detectEmotionFromBehavior(metrics: BehaviorMetrics): EmotionDetection {
    // sensitivity 影响 neutral 先验：high → 更易触发非 neutral 状态
    const sensitivity = loadEmotionPanelSettings().sensitivity
    const neutralBias = sensitivity === 'high' ? 0.40 : sensitivity === 'low' ? 0.70 : 0.55

    // 记录基线样本（持续学习）。和取偏差用的是同一个切换率，别算两遍。
    const windowMin = DETECTION_WINDOW / 1000 / 60
    const fileSwitchRate = metrics.fileSwitches / Math.max(windowMin, 0.1)
    emotionBaseline.recordSample(metrics.typingSpeed, metrics.errorRate, fileSwitchRate)

    // 打分本身在 `behaviorScoring.ts` 里，是个纯函数 —— 时间、设置、基线都由这里读好传进去。
    // 一次 `Date.now()` 供全程使用：原来同一次检测里取了四次，理论上能跨过整分钟边界，
    // 让 sessionMinutes 和 duration 对不上同一个瞬间。
    const now = Date.now()
    const scoring = scoreBehavior({
      metrics,
      neutralBias,
      relative: emotionBaseline.getRelativeMetrics(metrics.typingSpeed, metrics.errorRate, fileSwitchRate),
      idleDuration: now - this._lastActivityTime,
      sessionMinutes: (now - this.sessionStartTime) / 1000 / 60,
      hour: new Date(now).getHours(),
    })

    return {
      state: scoring.state,
      intensity: scoring.intensity,
      confidence: scoring.confidence,
      factors: scoring.factors,
      triggeredAt: now,
      duration: now - this.stateStartTime,
    }
  }

  private shouldNotifyStateChange(newDetection: EmotionDetection): boolean {
    if (!this.currentState) return true
    if (this.currentState.state !== newDetection.state) return true
    // 同一状态下，强度变化超过 0.12 也通知
    return Math.abs(this.currentState.intensity - newDetection.intensity) > 0.12
  }

  private recordHistory(detection: EmotionDetection): void {
    this.history.push({
      timestamp: detection.triggeredAt,
      state: detection.state,
      intensity: detection.intensity,
      project: this.currentProject,
      file: this.currentFile,
    })
    if (this.history.length > HISTORY_LIMIT) {
      this.history.shift()
    }
  }

  private cleanup(): void {
    if (this.typingTimer) { clearTimeout(this.typingTimer); this.typingTimer = null }
    if (this.pauseTimer) { clearInterval(this.pauseTimer); this.pauseTimer = null }
    if (this.analysisTimer) { clearInterval(this.analysisTimer); this.analysisTimer = null }
    if (this.samplingTimer) { clearInterval(this.samplingTimer); this.samplingTimer = null }

    if (this.keydownHandler) { window.removeEventListener('keydown', this.keydownHandler); this.keydownHandler = null }
    if (this.mousemoveHandler) { window.removeEventListener('mousemove', this.mousemoveHandler); this.mousemoveHandler = null }
    if (this.blurHandler) { window.removeEventListener('blur', this.blurHandler); this.blurHandler = null }
    if (this.focusHandler) { window.removeEventListener('focus', this.focusHandler); this.focusHandler = null }
  }
}

export const emotionDetectionEngine = new EmotionDetectionEngine()
