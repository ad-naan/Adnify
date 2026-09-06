import type { HTMLAttributes } from 'react'
import { DecorativeAnimationContext, useDecorativeAnimations } from '@/renderer/hooks/useDecorativeAnimations'

/** Shares the same motion policy with CSS and React animations in this surface. */
export function DecorativeAnimationScope({
  paused = false,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { paused?: boolean }) {
  const enabled = useDecorativeAnimations() && !paused

  return (
    <DecorativeAnimationContext.Provider value={enabled}>
      <div {...props} data-decorative-motion={enabled ? 'on' : 'off'} data-motion-occluded={paused || undefined}>
        {children}
      </div>
    </DecorativeAnimationContext.Provider>
  )
}
