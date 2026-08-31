import type { EmotionState } from '@/renderer/agent/types/emotion'
import { OtterAsset } from './OtterAsset'
import { EMOTION_OTTER_ASSETS, type OtterAssetKey } from './otterAssets'

const BACKGROUND_EFFECTS: Partial<Record<EmotionState, OtterAssetKey>> = {
  focused: 'emotionFocusRing',
  excited: 'emotionConfetti',
  flow: 'emotionEnergy',
}

const CORNER_EFFECTS: Partial<Record<EmotionState, OtterAssetKey>> = {
  frustrated: 'emotionAngry',
  tired: 'emotionSleep',
  bored: 'emotionLoading',
  stressed: 'emotionSweat',
}

export function EmotionOtterAsset({ state, className = '' }: { state: EmotionState; className?: string }) {
  const backgroundEffect = BACKGROUND_EFFECTS[state]
  const cornerEffect = CORNER_EFFECTS[state]

  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center ${className}`}>
      {backgroundEffect && (
        <OtterAsset
          asset={backgroundEffect}
          className="pointer-events-none absolute -inset-[18%] h-[136%] w-[136%] object-contain opacity-70"
        />
      )}
      <OtterAsset asset={EMOTION_OTTER_ASSETS[state]} className="relative z-10 h-full w-full object-contain" />
      {cornerEffect && (
        <OtterAsset
          asset={cornerEffect}
          className="pointer-events-none absolute -right-[18%] -top-[18%] z-20 h-[58%] w-[58%] object-contain"
        />
      )}
    </span>
  )
}
