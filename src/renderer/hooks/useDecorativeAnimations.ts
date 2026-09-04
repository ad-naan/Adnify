/**
 * 装饰性循环动画是否启用。
 *
 * 同时尊重系统的 prefers-reduced-motion、用户开关与窗口前后台状态。
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
    && (typeof document === 'undefined'
      || (document.visibilityState !== 'hidden' && document.hasFocus()))
}

export function useDecorativeAnimations(): boolean {
  const [enabled, setEnabled] = useState(resolve)

  useEffect(() => {
    const onChange = () => setEnabled(resolve())
    const unsubscribe = subscribeEmotionPanelSettings(onChange)
    const query = window.matchMedia?.(REDUCED_MOTION_QUERY)
    query?.addEventListener('change', onChange)
    document.addEventListener('visibilitychange', onChange)
    // Electron keeps background scheduling enabled for Agent work, so also
    // observe focus: visibility alone may stay "visible" in background windows.
    window.addEventListener('focus', onChange)
    window.addEventListener('blur', onChange)
    onChange()

    return () => {
      unsubscribe()
      query?.removeEventListener('change', onChange)
      document.removeEventListener('visibilitychange', onChange)
      window.removeEventListener('focus', onChange)
      window.removeEventListener('blur', onChange)
    }
  }, [])

  return enabled
}
