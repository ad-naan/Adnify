import { useState, useEffect, useRef } from 'react'

/**
 * Text stream reveal helper.
 *
 * While streaming, text is revealed as it arrives — StreamingBuffer already
 * batches arrivals to ~30 fps, so no per-frame loop is needed. Avoiding one
 * matters: each state update re-parses the whole markdown body, so a constant
 * requestAnimationFrame loop would do that ~60×/sec per streaming message.
 *
 * When streaming ends, a catch-up animation with exponential ease-out reveals
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

    if (isStreaming) {
      // Content-driven reveal: advance to the newly arrived content directly.
      // StreamingBuffer already throttles arrivals to ~30 fps, so this gives a
      // natural chunked reveal without a per-frame animation loop.
      if (displayedLenRef.current < content.length) {
        displayedLenRef.current = content.length
        setDisplayedContent(content)
      }
    } else {
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

  // Stream start: cancel any lingering catch-up from a previous stream.
  // No per-frame loop here — reveal is driven by content arrivals above.
  useEffect(() => {
    if (!isStreaming) return
    if (catchUpRafRef.current !== null) {
      cancelAnimationFrame(catchUpRafRef.current)
      catchUpRafRef.current = null
    }
  }, [isStreaming])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (catchUpRafRef.current !== null) cancelAnimationFrame(catchUpRafRef.current)
    }
  }, [])

  return displayedContent
}
