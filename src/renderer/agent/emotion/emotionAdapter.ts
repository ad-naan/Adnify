/**
 * 情绪环境适配服务
 * 根据情绪状态自动调整编辑器环境，并统一编排 companion feedback
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
import {
  loadEmotionPanelSettings,
  subscribeEmotionPanelSettings,
  type EmotionPanelSettings,
} from './panelSettings'

// 默认适配配置
const DEFAULT_ADAPTATIONS: Record<EmotionState, EnvironmentAdaptation> = {
  focused: {
    theme: {
      id: 'adnify-dark',
      brightness: 'normal',
      accentColor: '#3b82f6',
    },
    ui: {
      notifications: 'minimal',
      animationSpeed: 'normal',
      fontSize: 14,
      lineHeight: 1.5,
    },
    ai: {
      proactivity: 'suggestive',
      tone: 'neutral',
      suggestionFrequency: 'medium',
    },
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
    theme: {
      id: 'adnify-dark',
      brightness: 'dim',
      accentColor: '#f97316',
    },
    ui: {
      notifications: 'disabled',
      animationSpeed: 'slow',
      fontSize: 15,
      lineHeight: 1.6,
    },
    ai: {
      proactivity: 'active',
      tone: 'encouraging',
      suggestionFrequency: 'high',
    },
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
    theme: {
      id: 'adnify-dark',
      brightness: 'dim',
      accentColor: '#8b5cf6',
    },
    ui: {
      notifications: 'disabled',
      animationSpeed: 'slow',
      fontSize: 16,
      lineHeight: 1.7,
    },
    ai: {
      proactivity: 'active',
      tone: 'encouraging',
      suggestionFrequency: 'low',
    },
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
    theme: {
      id: 'adnify-dark',
      brightness: 'bright',
      accentColor: '#22c55e',
    },
    ui: {
      notifications: 'normal',
      animationSpeed: 'fast',
      fontSize: 14,
      lineHeight: 1.5,
    },
    ai: {
      proactivity: 'passive',
      tone: 'neutral',
      suggestionFrequency: 'low',
    },
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
    theme: {
      id: 'cyberpunk',
      brightness: 'bright',
      accentColor: '#ec4899',
    },
    ui: {
      notifications: 'normal',
      animationSpeed: 'fast',
      fontSize: 14,
      lineHeight: 1.5,
    },
    ai: {
      proactivity: 'active',
      tone: 'encouraging',
      suggestionFrequency: 'high',
    },
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
    theme: {
      id: 'midnight',
      brightness: 'dim',
      accentColor: '#06b6d4',
    },
    ui: {
      notifications: 'disabled',
      animationSpeed: 'slow',
      fontSize: 15,
      lineHeight: 1.6,
    },
    ai: {
      proactivity: 'active',
      tone: 'direct',
      suggestionFrequency: 'medium',
    },
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
    theme: {
      id: 'adnify-dark',
      brightness: 'normal',
      accentColor: '#6366f1',
    },
    ui: {
      notifications: 'disabled',
      animationSpeed: 'normal',
      fontSize: 14,
      lineHeight: 1.5,
    },
    ai: {
      proactivity: 'passive',
      tone: 'neutral',
      suggestionFrequency: 'low',
    },
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
    theme: {
      id: 'adnify-dark',
      brightness: 'normal',
      accentColor: '#3b82f6',
    },
    ui: {
      notifications: 'normal',
      animationSpeed: 'normal',
      fontSize: 14,
      lineHeight: 1.5,
    },
    ai: {
      proactivity: 'suggestive',
      tone: 'neutral',
      suggestionFrequency: 'medium',
    },
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

const EMOTION_MESSAGES: Record<EmotionState, string[]> = {
  focused: ['保持专注，你正在高效工作 💪', '良好的节奏，继续保持', '专注模式已启动'],
  frustrated: ['遇到困难了吗？深呼吸，一步步来 🌱', '每个 bug 都是成长的机会', '需要我帮你分析一下吗？', '休息一下，换个思路可能会更好'],
  tired: ['看起来有点累了，喝杯水休息一下吧 ☕', '长时间工作会降低效率，建议休息', '你的眼睛需要放松了，看看远处'],
  excited: ['充满能量！保持这个状态 🚀', '灵感爆发时刻，记录下来', '创造力满满，继续保持！'],
  bored: ['看起来有点无聊，试试重构这段代码？ 🤔', '要不要尝试一个新的实现方式？', '休息一下，做点有趣的事情'],
  stressed: ['压力有点大，深呼吸放松一下 🧘', '优先级排序，一件一件来', '你已经做得很好了，不要给自己太大压力', '需要我帮你整理一下思路吗？'],
  flow: ['进入心流状态，享受编码的乐趣 ✨', '完美的心流，继续保持', '你正在创造伟大的代码'],
  neutral: [],
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

    if (this.settings.autoAdapt) {
      this.applyThemeAdaptation(adaptation.theme)
      this.applyUIAdaptation(adaptation.ui)
    }
    this.applyAIAdaptation(adaptation.ai, detection)
    this.applySoundAdaptation(adaptation.sound)
    this.setupBreakReminders(adaptation.break, detection.state)
    this.showEmotionAwareness(detection)

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

  private emitFeedback(feedback: EmotionFeedbackPayload): void {
    if (!this.settings.companionEnabled || this.companionState.sessionMuted) return

    const cooldownKey = feedback.cooldownKey || feedback.type
    const lastShown = this.companionState.lastShownAtByType[feedback.type] || 0
    const cooldown = FEEDBACK_COOLDOWNS[feedback.type]
    if (Date.now() - lastShown < cooldown) return
    if (this.companionState.dismissedIds.includes(feedback.id)) return

    this.companionState.currentFeedback = feedback
    this.companionState.lastShownAtByType[feedback.type] = Date.now()
    EventBus.emit({ type: 'emotion:feedback', feedback })

    void cooldownKey
  }

  private buildFeedbackActions(detection: EmotionDetection) {
    return getRecommendedActions(detection).map((action) => ({
      id: `${action.type}-${detection.state}`,
      label: action.label,
      emoji: action.emoji,
      actionType: action.type,
    }))
  }

  private buildFeedback(
    type: EmotionFeedbackType,
    detection: EmotionDetection,
    message: string,
    sourceRule: string,
    priority: number,
    channelHints: Array<'statusBar' | 'editorBar' | 'panelLog'>,
    showFeedback = true,
  ): EmotionFeedbackPayload {
    const now = Date.now()
    return {
      id: `${type}-${detection.state}-${now}`,
      type,
      priority,
      emotionState: detection.state,
      message,
      shortMessage: message,
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

  private applyThemeAdaptation(theme: EnvironmentAdaptation['theme']): void {
    const root = document.documentElement
    const brightnessMap = {
      dim: '0.85',
      normal: '1',
      bright: '1.1',
    }
    root.style.setProperty('--editor-brightness', brightnessMap[theme.brightness])
    root.style.setProperty('--custom-accent', theme.accentColor)
  }

  private applyUIAdaptation(ui: EnvironmentAdaptation['ui']): void {
    const root = document.documentElement
    const speedMap = {
      slow: '0.5s',
      normal: '0.2s',
      fast: '0.1s',
    }
    root.style.setProperty('--transition-duration', speedMap[ui.animationSpeed])
  }

  private applyAIAdaptation(
    _ai: EnvironmentAdaptation['ai'],
    detection: EmotionDetection,
  ): void {
    const state = detection.state
    if (state === 'neutral' || state === 'flow') return
    if (!this.settings.companionEnabled) return

    const contextSuggestions = detection.suggestions || []
    const emitLegacy = (message: string) => {
      EventBus.emit({
        type: 'emotion:message',
        message,
        state,
      })
    }

    const emitStructured = (message: string, sourceRule: string) => {
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
        this.buildFeedback(type, detection, message, sourceRule, state === 'frustrated' ? 6 : 4, ['statusBar', 'editorBar', 'panelLog'])
      )
    }

    if (contextSuggestions.length > 0) {
      const t = setTimeout(() => {
        emitLegacy(contextSuggestions[0])
        emitStructured(contextSuggestions[0], 'context_suggestion')
      }, 2000)
      this.pendingTimeouts.push(t)
      return
    }

    const messages = EMOTION_MESSAGES[state]
    if (messages.length > 0) {
      const randomIndex = Math.floor(Math.random() * messages.length)
      const message = messages[randomIndex]
      const t = setTimeout(() => {
        emitLegacy(message)
        emitStructured(message, 'default_message')
      }, 3000)
      this.pendingTimeouts.push(t)
    }
  }

  private applySoundAdaptation(_sound: EnvironmentAdaptation['sound']): void {
    if (!this.settings.soundEnabled) {
      this.stopAmbientSound()
      return
    }
    this.stopAmbientSound()
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
        const message = '眼睛疲劳了吗？看看远处20秒 👀'
        EventBus.emit({ type: 'break:micro', message })
        this.emitFeedback(this.buildFeedback('break_micro', {
          state,
          intensity: 0.6,
          confidence: 1,
          triggeredAt: Date.now(),
          duration: 0,
          factors: [],
        }, message, 'micro_break_timer', 4, ['statusBar', 'editorBar']))
      }, 20 * 60 * 1000)
    }

    this.breakTimer = setInterval(() => {
      const messages: Record<EmotionState, string> = {
        focused: '你已经专注工作很久了，起来活动一下吧 🚶',
        frustrated: '卡住了？休息一下可能会有新思路 💡',
        tired: '该休息一下了，充电后效率会更高 ⚡',
        excited: '保持热情的同时也要注意休息哦 ☕',
        bored: '休息一下吧，做点有趣的事情 🎮',
        stressed: '压力大时更要休息，深呼吸放松一下 🧘',
        flow: '心流很美好，但也记得照顾好身体 🌿',
        neutral: '工作一段时间了，休息一下吧 ☕',
      }
      const message = messages[state]
      EventBus.emit({ type: 'break:suggested', message })
      this.emitFeedback(this.buildFeedback('break_suggested', {
        state,
        intensity: 0.7,
        confidence: 1,
        triggeredAt: Date.now(),
        duration: 0,
        factors: [],
      }, message, 'break_timer', 7, ['statusBar', 'editorBar', 'panelLog']))
    }, breakConfig.breakInterval)
  }

  private showEmotionAwareness(_detection: EmotionDetection): void {
  }

  private stopAmbientSound(): void {
    if (this.currentAudioSource instanceof HTMLAudioElement) {
      try {
        const audio = this.currentAudioSource
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
          } else {
            audio.volume = startVolume * (1 - elapsed / fadeOutDuration)
          }
        }, 50)
      } catch {
        this.currentAudioSource = null
      }
    } else if (this.currentAudioSource instanceof AudioBufferSourceNode) {
      try {
        if (this.currentGainNode && this.audioContext) {
          this.currentGainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 1)
          setTimeout(() => {
            try {
              if (this.currentAudioSource instanceof AudioBufferSourceNode) {
                this.currentAudioSource.stop()
              }
            } catch {}
            this.currentAudioSource = null
            this.currentGainNode = null
          }, 1100)
        } else {
          try {
            if (this.currentAudioSource instanceof AudioBufferSourceNode) {
              this.currentAudioSource.stop()
            }
          } catch {}
          this.currentAudioSource = null
        }
      } catch {
        this.currentAudioSource = null
        this.currentGainNode = null
      }
    }

    if (this.audioContext && !this.currentAudioSource) {
      try {
        this.audioContext.close().catch(() => { })
      } catch {}
      this.audioContext = null
    }
  }
}

export const emotionAdapter = new EmotionAdapter()
