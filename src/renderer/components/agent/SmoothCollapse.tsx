import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AGENT_DISCLOSURE_COLLAPSE_EVENT, AGENT_DISCLOSURE_COLLAPSE_MS } from '@renderer/agent/presentation/disclosureMotion'

interface SmoothCollapseProps {
  open: boolean
  children: React.ReactNode
  className?: string
  animateInitial?: boolean
}

/** Grid-based disclosure that animates intrinsic height without measuring it. */
function SmoothCollapse({ open, children, className = '', animateInitial = true }: SmoothCollapseProps) {
  const [isMounted, setIsMounted] = useState(open)
  const [visiblyOpen, setVisiblyOpen] = useState(open && !animateInitial)
  const rootRef = useRef<HTMLDivElement>(null)
  const previousOpenRef = useRef(open)

  useLayoutEffect(() => {
    const wasOpen = previousOpenRef.current
    previousOpenRef.current = open

    if (wasOpen && !open) {
      rootRef.current?.dispatchEvent(new CustomEvent(AGENT_DISCLOSURE_COLLAPSE_EVENT, {
        bubbles: true,
        detail: { durationMs: AGENT_DISCLOSURE_COLLAPSE_MS },
      }))
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setVisiblyOpen(false)
      if (!isMounted) return
      const timer = window.setTimeout(() => setIsMounted(false), AGENT_DISCLOSURE_COLLAPSE_MS)
      return () => window.clearTimeout(timer)
    }

    setIsMounted(true)
    const frame = window.requestAnimationFrame(() => setVisiblyOpen(true))
    return () => window.cancelAnimationFrame(frame)
  }, [isMounted, open])

  if (!isMounted) return null

  return (
    <div
      ref={rootRef}
      aria-hidden={!open}
      className={`agent-disclosure ${visiblyOpen ? 'is-open' : ''} ${className}`}
    >
      <div className="agent-disclosure-clip">{children}</div>
    </div>
  )
}

export default memo(SmoothCollapse)
