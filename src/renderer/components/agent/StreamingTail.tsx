import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'

export const STREAM_TAIL_REVEAL_MS = 380

export interface StreamingTailSegment {
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
export function useStreamingTailSegments(text: string, active: boolean): StreamingTailSnapshot {
  const nextIdRef = useRef(1)
  const [snapshot, setSnapshot] = useState<StreamingTailSnapshot>(() => ({
    text,
    segments: active && text
      ? [createSegment(0, 0, text.length)]
      : [],
  }))

  useLayoutEffect(() => {
    setSnapshot(current => {
      if (current.text === text) return current

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

interface HastNode {
  type: string
  value?: string
  children?: HastNode[]
  tagName?: string
  properties?: Record<string, unknown>
}

interface TailDescriptor {
  id: number
  length: number
  animate: boolean
}

/** Adds the same bounded suffix treatment after Markdown has been parsed. */
export function createStreamingTailPlugin(
  segments: StreamingTailSegment[],
  active: boolean,
) {
  const now = performance.now()
  const descriptors: TailDescriptor[] = segments.map(segment => ({
    id: segment.id,
    length: segment.end - segment.start,
    animate: segment.revealUntil > now,
  }))

  return () => (tree: HastNode) => {
    let descriptorIndex = descriptors.length - 1
    let descriptorRemaining = descriptors[descriptorIndex]?.length ?? 0
    let caretPending = true

    const caretNode = (): HastNode => ({
      type: 'element',
      tagName: 'span',
      properties: {
        className: ['stream-tail-caret', ...(active ? ['is-active'] : [])],
        ariaHidden: 'true',
      },
      children: [],
    })

    const visit = (parent: HastNode) => {
      if (!parent.children) return

      for (let index = parent.children.length - 1; index >= 0; index -= 1) {
        const child = parent.children[index]
        if (child.children?.length) {
          visit(child)
          if (!caretPending && descriptorIndex < 0) return
          continue
        }
        if (child.type !== 'text' || !child.value) continue

        const replacements: HastNode[] = []
        const reversePieces: HastNode[] = []
        let cursor = child.value.length

        while (cursor > 0 && descriptorIndex >= 0) {
          const descriptor = descriptors[descriptorIndex]
          let start = Math.max(0, cursor - descriptorRemaining)
          if (start > 0) {
            const codeUnit = child.value.charCodeAt(start)
            if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) start -= 1
          }

          const value = child.value.slice(start, cursor)
          reversePieces.push({
            type: 'element',
            tagName: 'span',
            properties: {
              className: descriptor.animate ? ['stream-token-in'] : [],
              dataStreamSegment: descriptor.id,
            },
            children: [{ type: 'text', value }],
          })
          cursor = start
          descriptorRemaining -= value.length

          if (descriptorRemaining <= 0) {
            descriptorIndex -= 1
            descriptorRemaining = descriptors[descriptorIndex]?.length ?? 0
          }
        }

        if (cursor > 0) replacements.push({ type: 'text', value: child.value.slice(0, cursor) })
        replacements.push(...reversePieces.reverse())
        if (caretPending) {
          replacements.push(caretNode())
          caretPending = false
        }
        parent.children.splice(index, 1, ...replacements)

        if (descriptorIndex < 0) return
      }
    }

    visit(tree)
    if (caretPending) tree.children?.push(caretNode())
  }
}
