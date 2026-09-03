import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'

const STREAM_TAIL_REVEAL_MS = 380

interface StreamingTailSegment {
  id: number
  start: number
  end: number
  revealUntil: number
}

interface StreamingTailSnapshot {
  text: string
  segments: StreamingTailSegment[]
}

function createSegment(id: number, start: number, end: number): StreamingTailSegment {
  return {
    id,
    start,
    end,
    revealUntil: performance.now() + STREAM_TAIL_REVEAL_MS,
  }
}

/** Tracks only the short, still-animating suffix. Settled text is compacted. */
function useStreamingTailSegments(text: string, active: boolean): StreamingTailSnapshot {
  const nextIdRef = useRef(1)
  const [snapshot, setSnapshot] = useState<StreamingTailSnapshot>(() => ({
    text,
    segments: active && text
      ? [createSegment(0, 0, text.length)]
      : [],
  }))

  useLayoutEffect(() => {
    setSnapshot(current => {
      if (current.text === text) {
        if (!active && current.segments.length > 0) {
          return { ...current, segments: [] }
        }
        return current
      }

      if (!active || !text.startsWith(current.text)) {
        return {
          text,
          segments: active && text
            ? [createSegment(nextIdRef.current++, 0, text.length)]
            : [],
        }
      }

      const now = performance.now()
      const segments = current.segments.filter(segment => segment.revealUntil > now)
      if (text.length > current.text.length) {
        segments.push(createSegment(nextIdRef.current++, current.text.length, text.length))
      }
      return { text, segments }
    })
  }, [active, text])

  useEffect(() => {
    if (snapshot.segments.length === 0) return
    const nextExpiry = Math.min(...snapshot.segments.map(segment => segment.revealUntil))
    const delay = Math.max(1, Math.ceil(nextExpiry - performance.now()))
    const timer = window.setTimeout(() => {
      const now = performance.now()
      setSnapshot(current => {
        const segments = current.segments.filter(segment => segment.revealUntil > now)
        return segments.length === current.segments.length ? current : { ...current, segments }
      })
    }, delay)
    return () => window.clearTimeout(timer)
  }, [snapshot.segments])

  return snapshot
}

export const StreamingPlainText = React.memo(({
  text,
  active,
}: {
  text: string
  active: boolean
}) => {
  const snapshot = useStreamingTailSegments(text, active)
  const pieces: React.ReactNode[] = []
  let cursor = 0

  snapshot.segments.forEach(segment => {
    if (cursor < segment.start) {
      pieces.push(snapshot.text.slice(cursor, segment.start))
    }
    pieces.push(
      <span key={segment.id} className="stream-token-in">
        {snapshot.text.slice(segment.start, segment.end)}
      </span>,
    )
    cursor = segment.end
  })

  if (cursor < snapshot.text.length) pieces.push(snapshot.text.slice(cursor))

  return (
    <>
      {pieces}
      <span className={`stream-tail-caret ${active ? 'is-active' : ''}`} aria-hidden="true" />
    </>
  )
})
StreamingPlainText.displayName = 'StreamingPlainText'
