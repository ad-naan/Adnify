import { publicAsset } from '@utils/publicAsset'
import type { EmotionState } from '@/renderer/agent/types/emotion'

export type OtterAssetKey =
  | 'assistantFace'
  | 'typing'
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
  | 'creative'
  | 'plans'
  | 'snippets'
  | 'outline'
  | 'shell'
  | 'logs'
  | 'searchEmpty'
  | 'idea'
  | 'toastSuccess'
  | 'toastError'
  | 'toastWarning'
  | 'toastInfo'
  | 'modalDanger'
  | 'emotionAngry'
  | 'emotionFocusRing'
  | 'emotionEnergy'
  | 'emotionSleep'
  | 'emotionConfetti'
  | 'emotionLoading'
  | 'emotionSweat'
  | 'gitStamping'
  | 'idlePaws'
  | 'relaxed'
  | 'sitThreeQuarter'
  | 'sitFront'
  | 'standFront'
  | 'waveStand'
  | 'sleepyFace'

export const OTTER_ASSET_PATHS: Record<OtterAssetKey, string> = {
  assistantFace: 'brand/ip/otter/faces/happy.webp',
  typing: 'brand/ip/otter/actions/typing.webp',
  working: 'brand/ip/otter/actions/holding_tablet.webp',
  success: 'brand/ip/otter/faces/proud.webp',
  warning: 'brand/ip/otter/faces/worried.webp',
  question: 'brand/ip/otter/fx/question_bubble.webp',
  rest: 'brand/ip/otter/body/sleep_curl.webp',
  // 情绪状态用的脸。约束有两条：语义相反的状态不能共用一张（focused 和 frustrated
  // 曾经都指向 curious.webp，界面上"专注"和"受挫"长得一模一样），而每张出厂的 webp
  // 都必须被注册（`otterAssets.test.ts` 的 "registers every shipped otter asset"）。
  // focused 和 flow 共用 focused.webp 是有意的 —— 两个都是专注类状态。
  focused: 'brand/ip/otter/faces/focused.webp',
  frustrated: 'brand/ip/otter/faces/confused.webp',
  tired: 'brand/ip/otter/faces/tired.webp',
  excited: 'brand/ip/otter/faces/proud.webp',
  bored: 'brand/ip/otter/faces/neutral.webp',
  stressed: 'brand/ip/otter/faces/worried.webp',
  flow: 'brand/ip/otter/faces/focused.webp',
  neutral: 'brand/ip/otter/faces/happy.webp',
  tool: 'brand/ip/otter/props/tiny_laptop.webp',
  chat: 'brand/ip/otter/actions/waving.webp',
  break: 'brand/ip/otter/actions/holding_coffee.webp',
  creative: 'brand/ip/otter/actions/holding_pen.webp',
  plans: 'brand/ip/otter/props/notebook.webp',
  snippets: 'brand/ip/otter/props/pencil.webp',
  outline: 'brand/ip/otter/props/notebook.webp',
  shell: 'brand/ip/otter/props/terminal.webp',
  logs: 'brand/ip/otter/props/activity_log.webp',
  // frustrated 拿走了 confused.webp，curious.webp 挪到这里 —— 空搜索结果本来就更像
  // "在找什么"而不是"没看懂"，而且这张脸必须有人注册，见上面那条注释。
  searchEmpty: 'brand/ip/otter/faces/curious.webp',
  idea: 'brand/ip/otter/fx/idea_bulb.webp',
  toastSuccess: 'brand/ip/otter/fx/success_stamp.webp',
  toastError: 'brand/ip/otter/fx/warning.webp',
  toastWarning: 'brand/ip/otter/fx/warning.webp',
  toastInfo: 'brand/ip/otter/fx/sparkles.webp',
  modalDanger: 'brand/ip/otter/actions/holding_bug.webp',
  emotionAngry: 'brand/ip/otter/fx/angry_mark.webp',
  emotionFocusRing: 'brand/ip/otter/fx/focus_ring.webp',
  emotionEnergy: 'brand/ip/otter/fx/energy_glow.webp',
  emotionSleep: 'brand/ip/otter/fx/sleep_zzz.webp',
  emotionConfetti: 'brand/ip/otter/fx/confetti.webp',
  emotionLoading: 'brand/ip/otter/fx/loading_dots.webp',
  emotionSweat: 'brand/ip/otter/fx/sweat_drop.webp',
  gitStamping: 'brand/ip/otter/actions/git_stamping.webp',
  idlePaws: 'brand/ip/otter/actions/idle_paws.webp',
  relaxed: 'brand/ip/otter/body/lie_relaxed.webp',
  sitThreeQuarter: 'brand/ip/otter/body/sit_3q.webp',
  sitFront: 'brand/ip/otter/body/sit_front.webp',
  standFront: 'brand/ip/otter/body/stand_front.webp',
  waveStand: 'brand/ip/otter/body/wave_stand.webp',
  sleepyFace: 'brand/ip/otter/faces/sleepy.webp',
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
