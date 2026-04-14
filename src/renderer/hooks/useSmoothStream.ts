import { useState, useEffect, useRef } from 'react'

/**
 * Smooth text stream interpolator with exponential ease-out.
 *
 * Each frame closes ~15% of the gap between displayed and target length.
 * When streaming ends, a final catch-up animation runs to smoothly reveal
 * any remaining buffered text instead of snapping.
 */
export function useSmoothStream(content: string, isStreaming: boolean, speedMultiplier = 1) {
  // 非流式模式下直接用完整内容初始化，避免初次渲染气泡内容为空的问题
  const [displayedContent, setDisplayedContent] = useState(() => isStreaming ? '' : content)
  const contentRef = useRef(content)
  const displayedLenRef = useRef(isStreaming ? 0 : content.length)
  const catchUpRafRef = useRef<number | null>(null)

  useEffect(() => {
    contentRef.current = content

    if (content.length < displayedLenRef.current) {
      displayedLenRef.current = content.length
      setDisplayedContent(content)
      return
    }

    if (!isStreaming) {
      // Streaming ended — animate remaining text instead of snapping
      if (displayedLenRef.current < content.length && catchUpRafRef.current === null) {
        const factor = 0.25 * speedMultiplier
        const catchUp = () => {
          const target = contentRef.current.length
          const current = displayedLenRef.current
          if (current < target) {
            const gap = target - current
            const step = gap <= 3 ? gap : Math.max(1, Math.ceil(gap * factor))
            displayedLenRef.current = Math.min(target, current + step)
            setDisplayedContent(contentRef.current.slice(0, displayedLenRef.current))
            catchUpRafRef.current = requestAnimationFrame(catchUp)
          } else {
            catchUpRafRef.current = null
          }
        }
        catchUpRafRef.current = requestAnimationFrame(catchUp)
      } else if (displayedLenRef.current >= content.length) {
        setDisplayedContent(content)
        displayedLenRef.current = content.length
      }
    }
  }, [content, isStreaming, speedMultiplier])

  // Main streaming animation loop
  useEffect(() => {
    if (!isStreaming) return

    // Cancel any lingering catch-up from a previous stream
    if (catchUpRafRef.current !== null) {
      cancelAnimationFrame(catchUpRafRef.current)
      catchUpRafRef.current = null
    }

    let rafId: number
    const factor = 0.15 * speedMultiplier

    const tick = () => {
      const targetLen = contentRef.current.length
      const currentLen = displayedLenRef.current

      if (currentLen < targetLen) {
        const gap = targetLen - currentLen
        const step = gap <= 3 ? gap : Math.max(1, Math.ceil(gap * factor))
        displayedLenRef.current = Math.min(targetLen, currentLen + step)
        setDisplayedContent(contentRef.current.slice(0, displayedLenRef.current))
      }

      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [isStreaming, speedMultiplier])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (catchUpRafRef.current !== null) cancelAnimationFrame(catchUpRafRef.current)
    }
  }, [])

  return displayedContent
}
