/**
 * 情绪环境适配服务
 *
 * 实际在做两件事：按情绪播放/停止环境音，以及编排 companion feedback（含休息提醒）。
 * 名字里的"环境适配"曾经还包括改主题和 UI，那部分是空转的，2026-09-02 删了 ——
 * 详见下面 `DEFAULT_ADAPTATIONS` 的注释。
 */

import { EventBus } from '../core/EventBus'
import { logger } from '@utils/Logger'
import type {
  EmotionState,
  EmotionDetection,
  EnvironmentAdaptation,
  EmotionCompanionState,
  EmotionFeedbackPayload,
  EmotionFeedbackType,
} from '../types/emotion'
import { getRecommendedActions } from './emotionActions'
import { EMOTION_STATUS_MESSAGE_KEYS } from './constants'
import type { TranslationKey } from '@shared/i18n'
import {
  loadEmotionPanelSettings,
  subscribeEmotionPanelSettings,
  type EmotionPanelSettings,
} from './panelSettings'

/**
 * 每个状态的适配参数。
 *
 * 原来还有 theme / ui / ai 三组，2026-09-02 全部删掉：
 * - `ai`（proactivity / tone / suggestionFrequency）从来没被读过 —— `applyAIAdaptation`
 *   的第一个参数叫 `_ai`，函数体一次都没碰它，也没有任何 prompt / 模型选择 / 采样参数
 *   路径引用过情绪。等平滑和 confidence 修好、检测信号可靠之后，再作为新功能设计接入；
 *   把一个每 12 秒重算一次、没有滞回、confidence 又被覆盖成固定值的信号接进 prompt，
 *   只会让 agent 因为用户看不见的原因忽冷忽热。
 * - `theme` / `ui` 写的是 `--editor-brightness` / `--custom-accent` /
 *   `--transition-duration` 三个自定义属性，而全仓库没有任何地方读它们；`theme.id`
 *   （cyberpunk / midnight）和 `ui.fontSize` / `lineHeight` / `notifications` 连写都没写。
 *   也就是说 `autoAdapt` 那个默认开着的开关什么都没做，一起删了。
 *
 * 剩下两组是真在生效的：`sound` 走 AudioContext 白噪音（默认关），`break` 走休息提醒。
 */
const DEFAULT_ADAPTATIONS: Record<EmotionState, EnvironmentAdaptation> = {
  focused: {
    sound: {
      enabled: false,
      volume: 0,
      type: 'none',
    },
    break: {
      suggestBreak: false,
      breakInterval: 90 * 60 * 1000,
      microBreaks: false,
    },
  },
  frustrated: {
    sound: {
      enabled: true,
      volume: 0.3,
      type: 'relax',
    },
    break: {
      suggestBreak: true,
      breakInterval: 15 * 60 * 1000,
      microBreaks: true,
    },
  },
  tired: {
    sound: {
      enabled: true,
      volume: 0.2,
      type: 'energize',
    },
    break: {
      suggestBreak: true,
      breakInterval: 30 * 60 * 1000,
      microBreaks: true,
    },
  },
  excited: {
    sound: {
      enabled: true,
      volume: 0.4,
      type: 'focus',
    },
    break: {
      suggestBreak: false,
      breakInterval: 120 * 60 * 1000,
      microBreaks: false,
    },
  },
  bored: {
    sound: {
      enabled: true,
      volume: 0.5,
      type: 'energize',
    },
    break: {
      suggestBreak: true,
      breakInterval: 45 * 60 * 1000,
      microBreaks: true,
    },
  },
  stressed: {
    sound: {
      enabled: true,
      volume: 0.25,
      type: 'relax',
    },
    break: {
      suggestBreak: true,
      breakInterval: 20 * 60 * 1000,
      microBreaks: true,
    },
  },
  flow: {
    sound: {
      enabled: true,
      volume: 0.3,
      type: 'focus',
    },
    break: {
      suggestBreak: false,
      breakInterval: 150 * 60 * 1000,
      microBreaks: true,
    },
  },
  neutral: {
    sound: {
      enabled: false,
      volume: 0,
      type: 'none',
    },
    break: {
      suggestBreak: true,
      breakInterval: 60 * 60 * 1000,
      microBreaks: true,
    },
  },
}

/**
 * 定时休息提醒的文案键，按当前情绪挑一句。
 *
 * 和状态栏轮播的 `emotion.status.*` 分开：那组是"你现在什么状态"，这组是"该起来动一动了"。
 */
const BREAK_SUGGESTION_KEYS: Record<EmotionState, TranslationKey> = {
  focused: 'emotion.break.suggested.focused',
  frustrated: 'emotion.break.suggested.frustrated',
  tired: 'emotion.break.suggested.tired',
  excited: 'emotion.break.suggested.excited',
  bored: 'emotion.break.suggested.bored',
  stressed: 'emotion.break.suggested.stressed',
  flow: 'emotion.break.suggested.flow',
  neutral: 'emotion.break.suggested.neutral',
}

const FEEDBACK_COOLDOWNS: Record<EmotionFeedbackType, number> = {
  encouragement: 10 * 60 * 1000,
  reassurance: 8 * 60 * 1000,
  focus_hint: 5 * 60 * 1000,
  frustration_support: 2 * 60 * 1000,
  fatigue_warning: 5 * 60 * 1000,
  break_micro: 20 * 60 * 1000,
  break_suggested: 20 * 60 * 1000,
  celebration: 15 * 60 * 1000,
}

const FEEDBACK_EXPIRES: Record<EmotionFeedbackType, number> = {
  encouragement: 12_000,
  reassurance: 20_000,
  focus_hint: 20_000,
  frustration_support: 30_000,
  fatigue_warning: 30_000,
  break_micro: 40_000,
  break_suggested: 40_000,
  celebration: 15_000,
}

const DEFAULT_SNOOZE_MS = 30 * 60 * 1000
const MAX_DISMISSED_IDS = 100

type AmbientSoundType = 'focus' | 'relax' | 'energize'

class EmotionAdapter {
  private currentAdaptation: EnvironmentAdaptation | null = null
  private breakTimer: NodeJS.Timeout | null = null
  private microBreakTimer: NodeJS.Timeout | null = null
  private audioContext: AudioContext | null = null
  private unsubscribeEmotionChanged: (() => void) | null = null
  private unsubscribeSettings: (() => void) | null = null
  private settings: EmotionPanelSettings = loadEmotionPanelSettings()
  private initialized = false
  private companionState: EmotionCompanionState = {
    currentFeedback: null,
    queue: [],
    lastShownAtByType: {},
    dismissedIds: [],
    sessionMuted: false,
    companionEnabled: this.settings.companionEnabled,
  }
  /** 跟踪所有待执行的 setTimeout，cleanup 时统一清理 */
  private pendingTimeouts: NodeJS.Timeout[] = []
  /** 当前正在播放的音频源 */
  private currentAudioSource: AudioBufferSourceNode | HTMLAudioElement | null = null
  /** 当前音频的增益节点 */
  private currentGainNode: GainNode | null = null
  /** 当前环境音类型（避免重复重启） */
  private currentSoundType: AmbientSoundType | 'none' | null = null
  /** 按 cooldownKey 记录上次展示时间 */
  private lastShownAtByCooldownKey: Record<string, number> = {}

  initialize(): void {
    if (this.initialized) return
    this.initialized = true
    this.settings = loadEmotionPanelSettings()
    this.companionState.companionEnabled = this.settings.companionEnabled
    this.stopAmbientSound()

    this.unsubscribeEmotionChanged = EventBus.on('emotion:changed', (event) => {
      if (event.emotion) {
        this.adaptToEmotion(event.emotion)
      }
    })

    this.unsubscribeSettings = subscribeEmotionPanelSettings((settings) => {
      this.settings = settings
      this.companionState.companionEnabled = settings.companionEnabled
      if (!settings.companionEnabled) {
        this.companionState.currentFeedback = null
        this.companionState.queue = []
      }
      if (!settings.soundEnabled) {
        this.stopAmbientSound()
      }
    })

    logger.agent.info('[EmotionAdapter] Initialized')
  }

  cleanup(): void {
    if (this.unsubscribeEmotionChanged) {
      this.unsubscribeEmotionChanged()
      this.unsubscribeEmotionChanged = null
    }
    if (this.unsubscribeSettings) {
      this.unsubscribeSettings()
      this.unsubscribeSettings = null
    }

    if (this.breakTimer) {
      clearInterval(this.breakTimer)
      this.breakTimer = null
    }
    if (this.microBreakTimer) {
      clearInterval(this.microBreakTimer)
      this.microBreakTimer = null
    }

    for (const t of this.pendingTimeouts) clearTimeout(t)
    this.pendingTimeouts = []
    this.stopAmbientSound()
    this.initialized = false

    logger.agent.info('[EmotionAdapter] Cleaned up')
  }

  adaptToEmotion(detection: EmotionDetection): void {
    const adaptation = DEFAULT_ADAPTATIONS[detection.state]
    this.currentAdaptation = adaptation

    this.emitCompanionFeedback(detection)
    this.applySoundAdaptation(adaptation.sound)
    this.setupBreakReminders(adaptation.break, detection.state)

    logger.agent.info('[EmotionAdapter] Adapted to:', detection.state)
  }

  forceAdapt(state: EmotionState): void {
    const mockDetection: EmotionDetection = {
      state,
      intensity: 0.8,
      confidence: 1,
      triggeredAt: Date.now(),
      duration: 0,
      factors: [],
    }
    this.adaptToEmotion(mockDetection)
  }

  getCurrentAdaptation(): EnvironmentAdaptation | null {
    return this.currentAdaptation
  }

  getSettings(): EmotionPanelSettings {
    return this.settings
  }

  /** 用户关闭某条反馈，并在 cooldown 窗口内不再展示同 key */
  dismissFeedback(feedbackId: string, cooldownKey?: string): void {
    if (!this.companionState.dismissedIds.includes(feedbackId)) {
      this.companionState.dismissedIds.push(feedbackId)
      if (this.companionState.dismissedIds.length > MAX_DISMISSED_IDS) {
        this.companionState.dismissedIds = this.companionState.dismissedIds.slice(-MAX_DISMISSED_IDS)
      }
    }
    const key = cooldownKey || feedbackId
    this.lastShownAtByCooldownKey[key] = Date.now()
    if (this.companionState.currentFeedback?.id === feedbackId) {
      this.companionState.currentFeedback = null
    }
  }

  /** 稍后提醒：暂停 companion 一段时间 */
  snoozeCompanion(durationMs = DEFAULT_SNOOZE_MS): void {
    this.companionState.snoozedUntil = Date.now() + durationMs
    this.companionState.currentFeedback = null
    this.companionState.queue = []
  }

  /** 本会话静音 companion */
  setSessionMuted(muted: boolean): void {
    this.companionState.sessionMuted = muted
    if (muted) {
      this.companionState.currentFeedback = null
      this.companionState.queue = []
    }
  }

  getCompanionState(): Readonly<EmotionCompanionState> {
    return this.companionState
  }

  private emitFeedback(feedback: EmotionFeedbackPayload): void {
    if (!this.settings.companionEnabled || this.companionState.sessionMuted) return
    if (this.companionState.snoozedUntil && Date.now() < this.companionState.snoozedUntil) return

    const cooldownKey = feedback.cooldownKey || feedback.type
    const lastShown = this.lastShownAtByCooldownKey[cooldownKey]
      ?? this.companionState.lastShownAtByType[feedback.type]
      ?? 0
    const cooldown = FEEDBACK_COOLDOWNS[feedback.type]
    if (Date.now() - lastShown < cooldown) return
    if (this.companionState.dismissedIds.includes(feedback.id)) return

    this.companionState.currentFeedback = feedback
    this.companionState.lastShownAtByType[feedback.type] = Date.now()
    this.lastShownAtByCooldownKey[cooldownKey] = Date.now()
    EventBus.emit({ type: 'emotion:feedback', feedback })
  }

  private buildFeedbackActions(detection: EmotionDetection) {
    return getRecommendedActions(detection).map((action) => ({
      id: `${action.type}-${detection.state}`,
      labelKey: action.labelKey,
      asset: action.asset,
      actionType: action.type,
    }))
  }

  private buildFeedback(
    type: EmotionFeedbackType,
    detection: EmotionDetection,
    messageKey: TranslationKey,
    sourceRule: string,
    priority: number,
    channelHints: Array<'statusBar'>,
    showFeedback = true,
  ): EmotionFeedbackPayload {
    const now = Date.now()
    return {
      id: `${type}-${detection.state}-${now}`,
      type,
      priority,
      emotionState: detection.state,
      messageKey,
      actions: this.buildFeedbackActions(detection),
      createdAt: now,
      expiresAt: now + FEEDBACK_EXPIRES[type],
      cooldownKey: `${type}:${detection.state}`,
      sourceRule,
      dismissible: true,
      channelHints,
      showFeedback,
    }
  }

  /**
   * 按当前状态发一条陪伴反馈。
   *
   * 原名 `applyAIAdaptation`，第一个参数是 `EnvironmentAdaptation['ai']` —— 但函数体
   * 一次都没读它（参数名就是 `_ai`）。名字和签名都在暗示"这里按情绪调整了 AI 行为"，
   * 实际做的只有发一条文案。参数删掉，名字改成它真正做的事。
   */
  private emitCompanionFeedback(detection: EmotionDetection): void {
    const state = detection.state
    if (state === 'neutral' || state === 'flow') return
    if (!this.settings.companionEnabled) return

    const contextSuggestions = detection.suggestions || []
    const emitStructured = (messageKey: TranslationKey, sourceRule: string) => {
      const type: EmotionFeedbackType =
        state === 'frustrated' || state === 'stressed'
          ? 'frustration_support'
          : state === 'tired'
            ? 'fatigue_warning'
            : state === 'focused'
              ? 'focus_hint'
              : state === 'excited'
                ? 'celebration'
                : 'encouragement'

      this.emitFeedback(
        this.buildFeedback(type, detection, messageKey, sourceRule, state === 'frustrated' ? 6 : 4, ['statusBar'])
      )
    }

    if (contextSuggestions.length > 0) {
      const t = setTimeout(() => {
        emitStructured(contextSuggestions[0], 'context_suggestion')
      }, 2000)
      this.pendingTimeouts.push(t)
      return
    }

    // 没有上下文建议时退回该状态的通用文案，和状态栏轮播用的是同一张键表 ——
    // 之前适配器自己还留了一份更长的中文副本，两处措辞长期对不上。
    const messages = EMOTION_STATUS_MESSAGE_KEYS[state]
    if (messages.length > 0) {
      const randomIndex = Math.floor(Math.random() * messages.length)
      const message = messages[randomIndex]
      const t = setTimeout(() => {
        emitStructured(message, 'default_message')
      }, 3000)
      this.pendingTimeouts.push(t)
    }
  }

  private applySoundAdaptation(sound: EnvironmentAdaptation['sound']): void {
    if (!this.settings.soundEnabled || !sound.enabled || !sound.type || sound.type === 'none') {
      this.stopAmbientSound()
      this.currentSoundType = null
      return
    }

    if (this.currentSoundType === sound.type && this.currentAudioSource) return

    this.stopAmbientSound()
    this.currentSoundType = sound.type
    void this.startAmbientSound(sound.type, sound.volume)
  }

  private async startAmbientSound(type: AmbientSoundType, volume: number): Promise<void> {
    try {
      const ctx = new AudioContext()
      this.audioContext = ctx

      const bufferSize = ctx.sampleRate * 2
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.25
      }

      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.loop = true

      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = type === 'focus' ? 450 : type === 'relax' ? 220 : 750
      filter.Q.value = 0.7

      const gainNode = ctx.createGain()
      gainNode.gain.value = 0
      source.connect(filter)
      filter.connect(gainNode)
      gainNode.connect(ctx.destination)

      source.start()
      this.currentAudioSource = source
      this.currentGainNode = gainNode

      const targetVolume = Math.min(Math.max(volume, 0), 1) * 0.12
      gainNode.gain.linearRampToValueAtTime(targetVolume, ctx.currentTime + 2)
    } catch (error) {
      logger.agent.warn('[EmotionAdapter] Failed to start ambient sound:', error)
      this.currentSoundType = null
    }
  }

  private setupBreakReminders(
    breakConfig: EnvironmentAdaptation['break'],
    state: EmotionState,
  ): void {
    if (this.breakTimer) {
      clearInterval(this.breakTimer)
      this.breakTimer = null
    }
    if (this.microBreakTimer) {
      clearInterval(this.microBreakTimer)
      this.microBreakTimer = null
    }

    if (!breakConfig.suggestBreak || !this.settings.companionEnabled) return

    if (breakConfig.microBreaks) {
      this.microBreakTimer = setInterval(() => {
        this.emitFeedback(this.buildFeedback('break_micro', {
          state,
          intensity: 0.6,
          confidence: 1,
          triggeredAt: Date.now(),
          duration: 0,
          factors: [],
        }, 'emotion.break.micro', 'micro_break_timer', 4, ['statusBar']))
      }, 20 * 60 * 1000)
    }

    this.breakTimer = setInterval(() => {
      this.emitFeedback(this.buildFeedback('break_suggested', {
        state,
        intensity: 0.7,
        confidence: 1,
        triggeredAt: Date.now(),
        duration: 0,
        factors: [],
      }, BREAK_SUGGESTION_KEYS[state], 'break_timer', 7, ['statusBar']))
    }, breakConfig.breakInterval)
  }

  private stopAmbientSound(): void {
    const source = this.currentAudioSource
    if (!source) {
      this.closeAudioContextIfIdle()
      this.currentSoundType = null
      return
    }

    if ('pause' in source && typeof source.pause === 'function') {
      try {
        const audio = source as HTMLAudioElement
        const fadeOutDuration = 1000
        const startVolume = audio.volume
        const startTime = Date.now()

        const fadeInterval = setInterval(() => {
          const elapsed = Date.now() - startTime
          if (elapsed >= fadeOutDuration) {
            audio.volume = 0
            audio.pause()
            audio.src = ''
            clearInterval(fadeInterval)
            this.currentAudioSource = null
            this.closeAudioContextIfIdle()
          } else {
            audio.volume = startVolume * (1 - elapsed / fadeOutDuration)
          }
        }, 50)
      } catch {
        this.currentAudioSource = null
        this.closeAudioContextIfIdle()
      }
      this.currentSoundType = null
      return
    }

    if ('stop' in source && typeof source.stop === 'function') {
      try {
        const bufferSource = source as AudioBufferSourceNode
        if (this.currentGainNode && this.audioContext) {
          this.currentGainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 1)
          setTimeout(() => {
            try {
              bufferSource.stop()
            } catch {}
            this.currentAudioSource = null
            this.currentGainNode = null
            this.closeAudioContextIfIdle()
          }, 1100)
        } else {
          try {
            bufferSource.stop()
          } catch {}
          this.currentAudioSource = null
          this.closeAudioContextIfIdle()
        }
      } catch {
        this.currentAudioSource = null
        this.currentGainNode = null
        this.closeAudioContextIfIdle()
      }
      this.currentSoundType = null
      return
    }

    this.currentAudioSource = null
    this.closeAudioContextIfIdle()
    this.currentSoundType = null
  }

  private closeAudioContextIfIdle(): void {
    if (this.audioContext && !this.currentAudioSource) {
      try {
        this.audioContext.close().catch(() => { })
      } catch {}
      this.audioContext = null
    }
  }
}

export const emotionAdapter = new EmotionAdapter()
