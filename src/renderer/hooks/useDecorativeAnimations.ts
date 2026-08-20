/**
 * 装饰性循环动画是否启用。
 *
 * 同时尊重系统的 prefers-reduced-motion 与用户在设置里的显式开关。
 * 用于门控 `repeat: Infinity` 的纯装饰动画 —— 它们由 framer-motion 每帧
 * 写 style 驱动，在集显上是持续的 GPU 光栅化开销。
 */

import { useEffect, useState } from 'react'
import { loadEmotionPanelSettings, subscribeEmotionPanelSettings } from '@/renderer/agent/emotion/panelSettings'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

function resolve(): boolean {
  return loadEmotionPanelSettings().decorativeAnimations && !prefersReducedMotion()
}

export function useDecorativeAnimations(): boolean {
  const [enabled, setEnabled] = useState(resolve)

  useEffect(() => {
    const unsubscribe = subscribeEmotionPanelSettings(() => setEnabled(resolve()))

    if (!window.matchMedia) return unsubscribe
    const query = window.matchMedia(REDUCED_MOTION_QUERY)
    const onChange = () => setEnabled(resolve())
    query.addEventListener('change', onChange)

    return () => {
      unsubscribe()
      query.removeEventListener('change', onChange)
    }
  }, [])

  return enabled
}
