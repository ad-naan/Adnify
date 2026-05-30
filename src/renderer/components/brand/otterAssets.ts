import { publicAsset } from '@utils/publicAsset'
import type { EmotionState } from '@/renderer/agent/types/emotion'

export type OtterAssetKey =
  | 'assistant'
  | 'assistantFace'
  | 'typing'
  | 'waving'
  | 'working'
  | 'success'
  | 'warning'
  | 'question'
  | 'rest'
  | 'focused'
  | 'frustrated'
  | 'tired'
  | 'excited'
  | 'bored'
  | 'stressed'
  | 'flow'
  | 'neutral'
  | 'tool'
  | 'chat'
  | 'break'
  | 'goal'
  | 'creative'

export const OTTER_ASSET_PATHS: Record<OtterAssetKey, string> = {
  assistant: 'brand/ip/ai-avatar.gif',
  assistantFace: 'brand/ip/otter/faces/happy.png',
  typing: 'brand/ip/otter/actions/typing.png',
  waving: 'brand/ip/otter/actions/waving.png',
  working: 'brand/ip/otter/actions/holding_tablet.png',
  success: 'brand/ip/otter/faces/proud.png',
  warning: 'brand/ip/otter/faces/worried.png',
  question: 'brand/ip/otter/faces/confused.png',
  rest: 'brand/ip/otter/body/sleep_curl.png',
  focused: 'brand/ip/otter/faces/focused.png',
  frustrated: 'brand/ip/otter/fx/sweat_drop.png',
  tired: 'brand/ip/otter/faces/sleepy.png',
  excited: 'brand/ip/otter/faces/proud.png',
  bored: 'brand/ip/otter/faces/neutral.png',
  stressed: 'brand/ip/otter/faces/worried.png',
  flow: 'brand/ip/otter/faces/focused.png',
  neutral: 'brand/ip/otter/faces/happy.png',
  tool: 'brand/ip/otter/props/terminal.png',
  chat: 'brand/ip/otter/actions/waving.png',
  break: 'brand/ip/otter/actions/holding_coffee.png',
  goal: 'brand/ip/otter/props/git_stamp.png',
  creative: 'brand/ip/otter/actions/holding_pen.png',
}

export const EMOTION_OTTER_ASSETS: Record<EmotionState, OtterAssetKey> = {
  focused: 'focused',
  frustrated: 'frustrated',
  tired: 'tired',
  excited: 'excited',
  bored: 'bored',
  stressed: 'stressed',
  flow: 'flow',
  neutral: 'neutral',
}

export function otterAssetSrc(key: OtterAssetKey): string {
  return publicAsset(OTTER_ASSET_PATHS[key])
}
