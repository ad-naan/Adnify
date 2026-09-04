import { memo, useEffect, useState } from 'react'
import { AGENT_DISCLOSURE_COLLAPSE_MS } from '@renderer/agent/presentation/disclosureMotion'

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
      aria-hidden={!open}
      className={`agent-disclosure ${visiblyOpen ? 'is-open' : ''} ${className}`}
    >
      <div className="agent-disclosure-clip">{children}</div>
    </div>
  )
}

export default memo(SmoothCollapse)
