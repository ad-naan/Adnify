import { useState, useEffect, useRef } from 'react'

/**
 * Highly optimized text stream interpolator.
 * Connects a chunky backend text stream and outputs a silky smooth 60fps text flow.
 * Uses requestAnimationFrame to catch up dynamically based on buffer size.
 */
export function useSmoothStream(content: string, isStreaming: boolean, speedMultiplier = 1) {
  const [displayedContent, setDisplayedContent] = useState('')
  const contentRef = useRef(content)
  const displayedLenRef = useRef(0)

  // Sync content Ref
  useEffect(() => {
    contentRef.current = content
    // If not streaming or if the content suddenly shrinks (e.g., cleared/restarted)
    if (!isStreaming || content.length < displayedLenRef.current) {
      setDisplayedContent(content)
      displayedLenRef.current = content.length
    }
  }, [content, isStreaming])

  // Process smooth flow
  useEffect(() => {
    if (!isStreaming) return

    let animationFrameId: number
    let lastTime = performance.now()

    const update = (time: DOMHighResTimeStamp) => {
      const targetLen = contentRef.current.length
      if (displayedLenRef.current < targetLen) {
        const delta = time - lastTime
        // How far behind are we? The bigger the gap, the faster we stream.
        const gap = targetLen - displayedLenRef.current
        
        // base speed logic: push at least 1-2 chars per frame, increase based on gap up to a soft limit
        let charsToAdd = gap > 200 ? Math.ceil(gap * 0.2) : Math.ceil(gap * (delta * 0.005))
        charsToAdd = Math.max(1, charsToAdd * speedMultiplier)

        displayedLenRef.current = Math.min(targetLen, displayedLenRef.current + charsToAdd)
        setDisplayedContent(contentRef.current.slice(0, displayedLenRef.current))
      }
      lastTime = time
      animationFrameId = requestAnimationFrame(update)
    }

    animationFrameId = requestAnimationFrame(update)
    return () => cancelAnimationFrame(animationFrameId)
  }, [isStreaming, speedMultiplier])

  return displayedContent
}
