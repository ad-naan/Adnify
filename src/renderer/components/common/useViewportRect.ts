import { useLayoutEffect, useState } from 'react'

export function useViewportRect(element: HTMLElement | null) {
  const [rect, setRect] = useState<{ element: HTMLElement; right: number; bottom: number; width: number; height: number; viewportWidth: number; viewportHeight: number }>()
  useLayoutEffect(() => {
    if (!element) return
    const measure = () => {
      const bounds = element.getBoundingClientRect()
      const next = { element, right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height,
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight }
      setRect(previous => previous && Object.entries(next).every(([key, value]) => previous[key as keyof typeof next] === value) ? previous : next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
  }, [element])
  return rect?.element === element ? rect : undefined
}
