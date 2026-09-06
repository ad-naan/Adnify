/**
 * 装饰性循环动画是否启用。
 *
 * 同时尊重系统减弱动态效果、用户开关、窗口状态与遮挡范围。
 * 所有消费者共用一组环境监听；暂停视觉效果不影响 Agent 执行。
 */

import { createContext, useContext, useSyncExternalStore } from 'react'
import { loadEmotionPanelSettings, subscribeEmotionPanelSettings } from '@/renderer/agent/emotion/panelSettings'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
export const DecorativeAnimationContext = createContext(true)
const listeners = new Set<() => void>()
let disconnect: (() => void) | undefined

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

function resolve(): boolean {
  return loadEmotionPanelSettings().decorativeAnimations && !prefersReducedMotion()
    && (typeof document === 'undefined'
      || (document.visibilityState !== 'hidden' && document.hasFocus()))
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    const onChange = () => listeners.forEach(notify => notify())
    const unsubscribe = subscribeEmotionPanelSettings(onChange)
    const query = window.matchMedia?.(REDUCED_MOTION_QUERY)
    query?.addEventListener('change', onChange)
    document.addEventListener('visibilitychange', onChange)
    // Electron keeps background scheduling enabled for Agent work, so also
    // observe focus: visibility alone may stay "visible" in background windows.
    window.addEventListener('focus', onChange)
    window.addEventListener('blur', onChange)
    disconnect = () => {
      unsubscribe()
      query?.removeEventListener('change', onChange)
      document.removeEventListener('visibilitychange', onChange)
      window.removeEventListener('focus', onChange)
      window.removeEventListener('blur', onChange)
    }
  }

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      disconnect?.()
      disconnect = undefined
    }
  }
}

export function useDecorativeAnimations(): boolean {
  const scopeEnabled = useContext(DecorativeAnimationContext)
  const enabled = useSyncExternalStore(subscribe, resolve, () => false)
  return scopeEnabled && enabled
}
