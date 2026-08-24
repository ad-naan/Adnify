/**
 * 情绪感知面板设置：localStorage 持久化
 */

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

const EMOTION_SETTINGS_KEY = 'adnify-emotion-panel-settings'
const EMOTION_SETTINGS_EVENT = 'adnify:emotion-settings-changed'

function isValidSensitivity(value: unknown): value is EmotionPanelSensitivity {
  return value === 'low' || value === 'medium' || value === 'high'
}

export function loadEmotionPanelSettings(): EmotionPanelSettings {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_EMOTION_PANEL_SETTINGS
    const raw = localStorage.getItem(EMOTION_SETTINGS_KEY)
    if (!raw) return DEFAULT_EMOTION_PANEL_SETTINGS
    const parsed = JSON.parse(raw) as Partial<EmotionPanelSettings>
    return {
      ...DEFAULT_EMOTION_PANEL_SETTINGS,
      ...parsed,
      sensitivity: isValidSensitivity(parsed.sensitivity) ? parsed.sensitivity : 'medium',
    }
  } catch {
    return DEFAULT_EMOTION_PANEL_SETTINGS
  }
}

export function saveEmotionPanelSettings(settings: EmotionPanelSettings): void {
  try {
    localStorage.setItem(EMOTION_SETTINGS_KEY, JSON.stringify(settings))
    window.dispatchEvent(new CustomEvent(EMOTION_SETTINGS_EVENT, { detail: settings }))
  } catch (_) {}
}

export function updateEmotionPanelSettings(patch: Partial<EmotionPanelSettings>): EmotionPanelSettings {
  const next = { ...loadEmotionPanelSettings(), ...patch }
  saveEmotionPanelSettings(next)
  return next
}

export function subscribeEmotionPanelSettings(listener: (settings: EmotionPanelSettings) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<EmotionPanelSettings>).detail
    listener(detail || loadEmotionPanelSettings())
  }

  window.addEventListener(EMOTION_SETTINGS_EVENT, handler)
  return () => window.removeEventListener(EMOTION_SETTINGS_EVENT, handler)
}
