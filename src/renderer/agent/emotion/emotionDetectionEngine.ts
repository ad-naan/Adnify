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
import { aggregateWindow, focusMinutes, scoreBehavior, smoothState, type StateSmoothing } from './behaviorScoring'
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
/**
 * 相邻两条历史之间最多按多少算进 Focus Time。
 *
 * 持续专注时每 24 秒补一条记录，所以正常间隔在 12~24 秒；60 秒的上限只挡异常情况 ——
 * 应用关了一夜再开、或者中间整段没写记录，那段空白不该算成"一直在专注"。
 */
const FOCUS_GAP_CAP = 60_000

class EmotionDetectionEngine {
  private metricsBuffer: BehaviorMetrics[] = []
  private history: EmotionHistory[] = []
  private currentState: EmotionDetection | null = null
  /** 状态平滑的游标：对外状态 + 正在等确认的候选，见 `smoothState`。 */
  private smoothing: StateSmoothing = { state: 'neutral', pending: null, pendingTicks: 0 }
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

    // Focus Time 按**相邻记录之间的实际间隔**累加，不按记录条数乘一个常数。
    //
    // 原来是 `focused/flow 的条数 × 12 秒`，但历史不是每 12 秒一条：广播被
    // `shouldNotifyStateChange` 挡着，持续专注时靠 `_focusRecordTicker >= 2` 每 24 秒
    // 才补写一条 —— 每条按 12 秒计，于是专注时间少报约一半。再叠一段"当前状态额外时长"
    // 的补偿逻辑去凑，反而更难说清哪段被算了几次。
    //
    // 现在每条记录算到下一条为止，最后一条算到现在。间隔上限挡住"应用关了几小时"
    // 和"中间漏了一大段记录"这两种情况整段被计进去。
    const focusTime = focusMinutes(dayHistory, Date.now(), FOCUS_GAP_CAP)

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
      // 这一个采样间隔里在打字就记满这段时长。原来存的是 `Date.now()` —— 一个绝对
      // 时间戳存进"连续打字时长(ms)"字段，然后被 aggregate 求和，加出来是天文数字。
      activeTypingTime: this.isTyping ? SAMPLE_INTERVAL : 0,
      pauseDuration: this.getCurrentPauseDuration(),
      keystrokes: this.liveCounters.keystrokes,
      backspaces: this.liveCounters.backspaces,
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
      baseDetection.confidence,
      context
    )

    // —— 合并因子 ——
    const contextFactors = this.buildContextFactors(context)
    const allFactors = [...baseDetection.factors, ...contextFactors]

    // —— 平滑：新状态要连续赢两个窗口才生效 ——
    // 没确认的窗口整个不算：既不改 currentState 也不广播，所以对外的 intensity 永远是
    // 某个真实窗口算出来的值。否则会出现"报 focused、强度却是 excited 那一档算出来的"。
    const smoothing = smoothState(this.smoothing, enhanced.state)
    this.smoothing = smoothing
    if (smoothing.state !== enhanced.state) return

    // stateStartTime 要在算 duration 之前更新：原来顺序是反的，所以状态切换那一个窗口
    // 报出去的 duration 是**上一个状态**待了多久。
    const now = Date.now()
    const stateChanged = !this.currentState || this.currentState.state !== enhanced.state
    if (stateChanged) this.stateStartTime = now

    const detection: EmotionDetection = {
      state: enhanced.state,
      intensity: enhanced.intensity,
      confidence: enhanced.confidence,
      triggeredAt: now,
      duration: now - this.stateStartTime,
      factors: allFactors,
      context: context || undefined,
      suggestions: enhanced.suggestions.length > 0 ? enhanced.suggestions : undefined,
    }

    const shouldBroadcast = this.shouldNotifyStateChange(detection)
    
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
        value: Math.min(diagErrors.errors / 5, 1),
        description: `${diagErrors.errors} errors, ${diagErrors.warnings} warnings (LSP)`,
      })
    }

    // AI 交互因子
    if (context.aiInteractions.count > 0) {
      factors.push({
        type: 'ai_interaction_pattern',
        value: Math.min(context.aiInteractions.count / 10, 1),
        description: `${context.aiInteractions.count} AI interactions, avg ${(context.aiInteractions.avgResponseTime / 1000).toFixed(1)}s`,
      })
    }

    // Git 状态因子
    if (context.gitStatus && context.gitStatus !== 'clean') {
      factors.push({
        type: 'git_activity',
        value: context.gitStatus === 'conflict' ? 1.0 : 0.5,
        description: `Git: ${context.gitStatus}`,
      })
    }

    // 文件类型因子
    factors.push({
      type: 'file_type_pattern',
      value: context.fileType === 'test' ? 0.7 : context.fileType === 'config' ? 0.5 : 0.3,
      description: `File: ${context.fileType} (${context.currentFile.split('/').pop()})`,
    })

    // 文件切换/搜索因子
    if (context.searchQueries > 3) {
      factors.push({
        type: 'search_pattern',
        value: Math.min(context.searchQueries / 10, 1),
        description: `${context.searchQueries} file switches (15min)`,
      })
    }

    // 代码复杂度因子
    if (context.codeComplexity > 0.3) {
      factors.push({
        type: 'code_complexity',
        value: context.codeComplexity,
        description: `Complexity: ${(context.codeComplexity * 100).toFixed(0)}%`,
      })
    }

    return factors
  }

  private aggregateMetrics(metrics: BehaviorMetrics[]): BehaviorMetrics {
    if (metrics.length === 0) return this.createEmptyMetrics()
    return aggregateWindow(metrics, SAMPLE_INTERVAL)
  }

  private createEmptyMetrics(): BehaviorMetrics {
    return {
      timestamp: Date.now(), typingSpeed: 0, errorRate: 0,
      activeTypingTime: 0, pauseDuration: 0, keystrokes: 0,
      backspaces: 0, cursorMovement: 0, copyPasteCount: 0,
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
