/**
 * 情绪感知面板设置：electron-store 持久化，localStorage 仅作启动缓存。
 */

import { createPersistentPreference } from '@/renderer/settings/persistentPreference'
import { USER_PREFERENCE_KEYS } from '@/renderer/settings/preferenceKeys'

export type EmotionPanelSensitivity = 'low' | 'medium' | 'high'

export interface EmotionPanelSettings {
  ambientGlow: boolean
  soundEnabled: boolean
  companionEnabled: boolean
  autoAdapt: boolean
  /** 开启后仅内存检测，不写入 baseline / feedback 等 localStorage */
  privacyMode: boolean
  sensitivity: EmotionPanelSensitivity
  /**
   * 装饰性循环动画总开关。关闭后所有 `repeat: Infinity` 的纯装饰动画停止。
   *
   * 这类动画由 framer-motion 用 JS 每帧改写 style，且多数作用在 scale /
   * filter / background-position 上 —— 这些属性无法留在合成器层，每帧都要
   * 重新光栅化。在集显上实测可让 GPU 3D 占用长期停在 80% 以上。
   * 表达状态的动画（加载中、流式输出）不受此开关影响。
   */
  decorativeAnimations: boolean
}

export const DEFAULT_EMOTION_PANEL_SETTINGS: EmotionPanelSettings = {
  ambientGlow: true,
  soundEnabled: false,
  companionEnabled: true,
  autoAdapt: true,
  privacyMode: false,
  sensitivity: 'medium',
  decorativeAnimations: true,
}

export function isEmotionPrivacyMode(): boolean {
  return loadEmotionPanelSettings().privacyMode
}

function isValidSensitivity(value: unknown): value is EmotionPanelSensitivity {
  return value === 'low' || value === 'medium' || value === 'high'
}

export function normalizeEmotionPanelSettings(value: unknown): EmotionPanelSettings {
  const parsed = (value && typeof value === 'object' ? value : {}) as Partial<EmotionPanelSettings>
  return {
    ambientGlow: typeof parsed.ambientGlow === 'boolean' ? parsed.ambientGlow : DEFAULT_EMOTION_PANEL_SETTINGS.ambientGlow,
    soundEnabled: typeof parsed.soundEnabled === 'boolean' ? parsed.soundEnabled : DEFAULT_EMOTION_PANEL_SETTINGS.soundEnabled,
    companionEnabled: typeof parsed.companionEnabled === 'boolean' ? parsed.companionEnabled : DEFAULT_EMOTION_PANEL_SETTINGS.companionEnabled,
    autoAdapt: typeof parsed.autoAdapt === 'boolean' ? parsed.autoAdapt : DEFAULT_EMOTION_PANEL_SETTINGS.autoAdapt,
    privacyMode: typeof parsed.privacyMode === 'boolean' ? parsed.privacyMode : DEFAULT_EMOTION_PANEL_SETTINGS.privacyMode,
    sensitivity: isValidSensitivity(parsed.sensitivity) ? parsed.sensitivity : 'medium',
    decorativeAnimations: typeof parsed.decorativeAnimations === 'boolean'
      ? parsed.decorativeAnimations
      : DEFAULT_EMOTION_PANEL_SETTINGS.decorativeAnimations,
  }
}

const preference = createPersistentPreference<EmotionPanelSettings>({
  ...USER_PREFERENCE_KEYS.emotionPanelSettings, fallback: DEFAULT_EMOTION_PANEL_SETTINGS, normalize: normalizeEmotionPanelSettings,
})

export function loadEmotionPanelSettings(): EmotionPanelSettings {
  return preference.load()
}

export function saveEmotionPanelSettings(settings: EmotionPanelSettings): void {
  preference.save(settings)
}

export function updateEmotionPanelSettings(patch: Partial<EmotionPanelSettings>): EmotionPanelSettings {
  return preference.update(patch)
}

export function subscribeEmotionPanelSettings(listener: (settings: EmotionPanelSettings) => void): () => void {
  return preference.subscribe(listener)
}
