import { useCallback, useEffect, useRef, useState } from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'

const CHAT_BOTTOM_THRESHOLD = 220

interface VisibleRange {
  startIndex: number
  endIndex: number
}

interface UseChatScrollControllerOptions {
  isHydratingActiveThread: boolean
  isStreaming: boolean
  isSwitchingThread: boolean
  messageCount: number
  threadId: string | null
}

export function useChatScrollController({
  isHydratingActiveThread,
  isStreaming,
  isSwitchingThread,
  messageCount,
  threadId,
}: UseChatScrollControllerOptions) {
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const isAutoScrollingRef = useRef(false)
  const atBottomRef = useRef(true)
  const pendingBottomSnapRef = useRef(true)
  const lastScrollTopRef = useRef(0)
  const stickyFrameRef = useRef<number | null>(null)
  const [scrollerElement, setScrollerElement] = useState<HTMLDivElement | null>(null)
  const [showScrollButton, setShowScrollButton] = useState(false)

  const getBottomMetrics = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) {
      return {
        bottom: atBottomRef.current,
        hasOverflow: false,
      }
    }

    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    const hasOverflow = scroller.scrollHeight - scroller.clientHeight > 4
    const bottom = !hasOverflow || distanceFromBottom <= CHAT_BOTTOM_THRESHOLD

    return { bottom, hasOverflow }
  }, [])

  const syncBottomState = useCallback((bottom: boolean, hasOverflow = true) => {
    atBottomRef.current = bottom
    setShowScrollButton(hasOverflow && !bottom)
  }, [])

  const syncBottomStateFromScroller = useCallback(() => {
    const { bottom, hasOverflow } = getBottomMetrics()
    syncBottomState(bottom, hasOverflow)
  }, [getBottomMetrics, syncBottomState])

  const scrollToBottom = useCallback((behavior: 'auto' | 'smooth' = 'smooth') => {
    if (messageCount <= 0) return

    atBottomRef.current = true
    setShowScrollButton(false)

    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({
        index: messageCount - 1,
        align: 'end',
        behavior,
      })
      requestAnimationFrame(syncBottomStateFromScroller)
    })
  }, [messageCount, syncBottomStateFromScroller])

  const stickToBottom = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller || messageCount <= 0) return

    isAutoScrollingRef.current = true
    atBottomRef.current = true
    setShowScrollButton(false)

    // Virtuoso's followOutput handles ordinary list growth. This is only the
    // fallback for height changes inside the last row (streamed Markdown), so
    // write the scroll position once and let the next frame settle its state.
    scroller.scrollTop = scroller.scrollHeight

    requestAnimationFrame(() => {
      lastScrollTopRef.current = scroller.scrollTop
      isAutoScrollingRef.current = false
    })
  }, [messageCount])

  const scheduleStickToBottom = useCallback(() => {
    if (stickyFrameRef.current !== null) return
    stickyFrameRef.current = requestAnimationFrame(() => {
      stickyFrameRef.current = null
      stickToBottom()
    })
  }, [stickToBottom])

  const followOutput = useCallback((isListAtBottom: boolean) => {
    return (isListAtBottom || atBottomRef.current) ? 'auto' : false
  }, [])

  const handleTotalListHeightChanged = useCallback(() => {
    // Virtuoso already publishes bottom intent using the same threshold below.
    // Reading scrollHeight here would force layout on every streamed row resize.
    if (!atBottomRef.current) return

    setShowScrollButton(false)
    scheduleStickToBottom()
  }, [scheduleStickToBottom])

  const handleBottomStateChange = useCallback((bottom: boolean) => {
    if (isAutoScrollingRef.current) return
    // A non-bottom Virtuoso state implies overflow; a bottom state always hides
    // the button. No DOM measurement is needed on this hot callback.
    syncBottomState(bottom)
  }, [syncBottomState])

  const handleVisibleRangeChanged = useCallback((_range: VisibleRange) => {
    // Scroll metrics are the source of truth. Virtuoso range updates can arrive
    // before DOM scroll measurements settle and cause stale bottom-button state.
  }, [])

  const attachScrollerNode = useCallback((node: HTMLDivElement | null) => {
    if (scrollerRef.current === node) return
    scrollerRef.current = node
    // The listener effect below has to follow the real DOM node, not just the
    // ref. Switching threads remounts Virtuoso and replaces the scroller, so a
    // ref-only update would leave the scroll listener and ResizeObserver bound
    // to the detached node and the new list would never hear about scrolling.
    setScrollerElement(node)
    if (!node) return

    requestAnimationFrame(() => {
      syncBottomStateFromScroller()
    })
  }, [syncBottomStateFromScroller])

  useEffect(() => {
    pendingBottomSnapRef.current = true
    // A new thread's list mounts pinned to its last row, so bottom is the
    // correct starting assumption. Carrying the previous thread's scrolled-up
    // state over would flash the jump-to-bottom button and make followOutput
    // refuse to follow until Virtuoso republishes its own bottom state.
    atBottomRef.current = true
    lastScrollTopRef.current = 0
    setShowScrollButton(false)
  }, [threadId])

  useEffect(() => {
    if (!pendingBottomSnapRef.current) return
    if (isSwitchingThread || isHydratingActiveThread || messageCount === 0) return

    pendingBottomSnapRef.current = false
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // The list now mounts with initialTopMostItemIndex pinned to the last
        // row, so the common case is already at the bottom. Re-running
        // scrollToIndex there would only buy another measurement pass over the
        // variable-height rows, so it stays a fallback for the cases where the
        // first frame did not land at the bottom.
        if (getBottomMetrics().bottom) {
          syncBottomStateFromScroller()
          return
        }
        scrollToBottom('auto')
      })
    })
  }, [getBottomMetrics, isSwitchingThread, isHydratingActiveThread, messageCount, scrollToBottom, syncBottomStateFromScroller])

  useEffect(() => {
    syncBottomStateFromScroller()
  }, [messageCount, syncBottomStateFromScroller])

  useEffect(() => {
    const scroller = scrollerElement
    if (!scroller) return

    const handleScroll = () => {
      if (isAutoScrollingRef.current) return
      const previousTop = lastScrollTopRef.current
      const currentTop = scroller.scrollTop
      lastScrollTopRef.current = currentTop

      if (isStreaming && currentTop < previousTop - 2) {
        const { hasOverflow } = getBottomMetrics()
        syncBottomState(false, hasOverflow)
        return
      }

      if (isStreaming && currentTop >= previousTop) {
        const { bottom, hasOverflow } = getBottomMetrics()
        if (bottom || atBottomRef.current) {
          syncBottomState(true, hasOverflow)
          scheduleStickToBottom()
          return
        }
      }

      syncBottomStateFromScroller()
    }

    lastScrollTopRef.current = scroller.scrollTop
    handleScroll()
    scroller.addEventListener('scroll', handleScroll, { passive: true })

    const resizeObserver = new ResizeObserver(() => {
      if (isStreaming && atBottomRef.current) {
        setShowScrollButton(false)
        scheduleStickToBottom()
        return
      }
      syncBottomStateFromScroller()
    })
    resizeObserver.observe(scroller)

    return () => {
      scroller.removeEventListener('scroll', handleScroll)
      resizeObserver.disconnect()
    }
  }, [getBottomMetrics, isStreaming, scheduleStickToBottom, scrollerElement, syncBottomState, syncBottomStateFromScroller])

  useEffect(() => {
    return () => {
      if (stickyFrameRef.current !== null) {
        cancelAnimationFrame(stickyFrameRef.current)
      }
    }
  }, [])

  return {
    atBottomThreshold: CHAT_BOTTOM_THRESHOLD,
    attachScrollerNode,
    followOutput,
    handleBottomStateChange,
    handleTotalListHeightChanged,
    handleVisibleRangeChanged,
    scrollToBottom,
    showScrollButton,
    virtuosoRef,
  }
}
