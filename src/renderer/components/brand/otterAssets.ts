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
  | 'plans'
  | 'snippets'
  | 'outline'
  | 'shell'
  | 'logs'
  | 'searchEmpty'
  | 'workspace'
  | 'idea'
  | 'toastSuccess'
  | 'toastError'
  | 'toastWarning'
  | 'toastInfo'
  | 'modalDanger'
  | 'modalWarning'
  | 'modalInfo'
  | 'emotionSurprised'
  | 'emotionAngry'
  | 'emotionFocusRing'
  | 'emotionEnergy'
  | 'emotionSparkles'
  | 'emotionSleep'

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
  plans: 'brand/ip/otter/props/notebook.png',
  snippets: 'brand/ip/otter/props/pencil.png',
  outline: 'brand/ip/otter/props/notebook.png',
  shell: 'brand/ip/otter/props/terminal.png',
  logs: 'brand/ip/otter/props/terminal.png',
  searchEmpty: 'brand/ip/otter/faces/curious.png',
  workspace: 'brand/ip/otter/props/desk_lamp.png',
  idea: 'brand/ip/otter/fx/question_bubble.png',
  toastSuccess: 'brand/ip/otter/fx/success_stamp.png',
  toastError: 'brand/ip/otter/fx/warning.png',
  toastWarning: 'brand/ip/otter/fx/warning.png',
  toastInfo: 'brand/ip/otter/fx/sparkles.png',
  modalDanger: 'brand/ip/otter/actions/holding_bug.png',
  modalWarning: 'brand/ip/otter/fx/warning.png',
  modalInfo: 'brand/ip/otter/faces/surprised.png',
  emotionSurprised: 'brand/ip/otter/faces/surprised.png',
  emotionAngry: 'brand/ip/otter/fx/angry_mark.png',
  emotionFocusRing: 'brand/ip/otter/fx/focus_ring.png',
  emotionEnergy: 'brand/ip/otter/fx/energy_glow.png',
  emotionSparkles: 'brand/ip/otter/fx/sparkles.png',
  emotionSleep: 'brand/ip/otter/fx/sleep_zzz.png',
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
