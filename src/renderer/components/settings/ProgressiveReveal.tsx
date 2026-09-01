import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { t, type Language } from '@shared/i18n'

interface ProgressiveRevealProps {
  children: ReactNode
  collapsedHeight?: number
  language: Language
  expandLabel?: string
  collapseLabel?: string
  className?: string
}

/**
 * Keeps the beginning of optional or high-volume settings visible and places
 * the disclosure action over a bottom fade. Unlike an accordion, the section
 * always retains useful context while collapsed.
 */
export function ProgressiveReveal({
  children,
  collapsedHeight = 320,
  language,
  expandLabel,
  collapseLabel,
  className = '',
}: ProgressiveRevealProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [canCollapse, setCanCollapse] = useState(true)

  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) return
    const measure = () => setCanCollapse(content.scrollHeight > collapsedHeight + 8)
    measure()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    observer?.observe(content)
    return () => observer?.disconnect()
  }, [collapsedHeight])

  return (
    <div className={`relative ${className}`}>
      <div
        ref={contentRef}
        className={canCollapse && !expanded ? 'overflow-hidden' : ''}
        style={canCollapse && !expanded ? { maxHeight: collapsedHeight } : undefined}
      >
        {children}
      </div>

      {canCollapse && !expanded && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex h-24 items-end justify-center pb-2"
          style={{ background: 'linear-gradient(to top, rgb(var(--surface)) 12%, rgb(var(--surface) / 0.94) 48%, transparent)' }}
        >
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); setExpanded(true) }}
            className="pointer-events-auto inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-surface px-4 text-xs font-medium text-text-secondary shadow-lg transition-colors hover:border-accent/40 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            {expandLabel || t('progressiveReveal.showAll', language)}
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {canCollapse && expanded && (
        <div className="mt-3 flex justify-center border-t border-border/40 pt-3">
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); setExpanded(false) }}
            className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full px-4 text-xs font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            {collapseLabel || t('progressiveReveal.showLess', language)}
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
