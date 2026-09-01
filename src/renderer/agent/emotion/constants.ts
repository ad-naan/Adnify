import type { EmotionState } from '../types/emotion'
import type { TranslationKey } from '@shared/i18n'
import type { OtterAssetKey } from '@/renderer/components/brand/otterAssets'

export const EMOTION_COLORS: Record<EmotionState, string> = {
  focused: '#3b82f6',
  frustrated: '#f97316',
  tired: '#8b5cf6',
  excited: '#22c55e',
  bored: '#6b7280',
  stressed: '#06b6d4',
  flow: '#6366f1',
  neutral: '#94a3b8',
}

export const EMOTION_META: Record<EmotionState, {
  color: string
  asset: OtterAssetKey
  pulseSpeed: number
  translationKey: TranslationKey
}> = {
  focused: { color: EMOTION_COLORS.focused, asset: 'focused', pulseSpeed: 2.5, translationKey: 'emotion.state.focused' },
  frustrated: { color: EMOTION_COLORS.frustrated, asset: 'frustrated', pulseSpeed: 1.2, translationKey: 'emotion.state.frustrated' },
  tired: { color: EMOTION_COLORS.tired, asset: 'tired', pulseSpeed: 4.0, translationKey: 'emotion.state.tired' },
  excited: { color: EMOTION_COLORS.excited, asset: 'excited', pulseSpeed: 0.8, translationKey: 'emotion.state.excited' },
  bored: { color: EMOTION_COLORS.bored, asset: 'bored', pulseSpeed: 3.5, translationKey: 'emotion.state.bored' },
  stressed: { color: EMOTION_COLORS.stressed, asset: 'stressed', pulseSpeed: 1.0, translationKey: 'emotion.state.stressed' },
  flow: { color: EMOTION_COLORS.flow, asset: 'flow', pulseSpeed: 2.0, translationKey: 'emotion.state.flow' },
  neutral: { color: EMOTION_COLORS.neutral, asset: 'neutral', pulseSpeed: 3.0, translationKey: 'emotion.state.neutral' },
}

export const EMOTION_STATUS_MESSAGE_KEYS: Record<EmotionState, TranslationKey[]> = {
  focused: ['emotion.status.focused.1', 'emotion.status.focused.2', 'emotion.status.focused.3'],
  frustrated: ['emotion.status.frustrated.1', 'emotion.status.frustrated.2', 'emotion.status.frustrated.3'],
  tired: ['emotion.status.tired.1', 'emotion.status.tired.2', 'emotion.status.tired.3'],
  excited: ['emotion.status.excited.1', 'emotion.status.excited.2', 'emotion.status.excited.3'],
  bored: ['emotion.status.bored.1', 'emotion.status.bored.2', 'emotion.status.bored.3'],
  stressed: ['emotion.status.stressed.1', 'emotion.status.stressed.2', 'emotion.status.stressed.3'],
  flow: ['emotion.status.flow.1', 'emotion.status.flow.2', 'emotion.status.flow.3'],
  neutral: ['emotion.status.neutral.1', 'emotion.status.neutral.2', 'emotion.status.neutral.3'],
}
