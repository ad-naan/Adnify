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

    scroller.scrollTop = scroller.scrollHeight
    virtuosoRef.current?.autoscrollToBottom()

    requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight
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
    if (isStreaming) return (isListAtBottom || atBottomRef.current) ? 'auto' : false
    return (isListAtBottom || atBottomRef.current) ? 'auto' : false
  }, [isStreaming])

  const handleTotalListHeightChanged = useCallback(() => {
    if (!isStreaming) {
      requestAnimationFrame(syncBottomStateFromScroller)
      return
    }

    const { bottom } = getBottomMetrics()
    if (!atBottomRef.current && !bottom) {
      requestAnimationFrame(syncBottomStateFromScroller)
      return
    }

    atBottomRef.current = true
    isAutoScrollingRef.current = true
    setShowScrollButton(false)

    requestAnimationFrame(() => {
      stickToBottom()
      requestAnimationFrame(() => {
        stickToBottom()
        requestAnimationFrame(() => {
          isAutoScrollingRef.current = false
          syncBottomStateFromScroller()
        })
      })
    })
  }, [getBottomMetrics, isStreaming, stickToBottom, syncBottomStateFromScroller])

  const handleBottomStateChange = useCallback((bottom: boolean) => {
    if (isAutoScrollingRef.current) return

    const { hasOverflow } = getBottomMetrics()
    syncBottomState(bottom, hasOverflow)
  }, [getBottomMetrics, syncBottomState])

  const handleVisibleRangeChanged = useCallback((_range: VisibleRange) => {
    // Scroll metrics are the source of truth. Virtuoso range updates can arrive
    // before DOM scroll measurements settle and cause stale bottom-button state.
  }, [])

  const attachScrollerNode = useCallback((node: HTMLDivElement | null) => {
    scrollerRef.current = node
    if (!node) return

    requestAnimationFrame(() => {
      syncBottomStateFromScroller()
    })
  }, [syncBottomStateFromScroller])

  useEffect(() => {
    pendingBottomSnapRef.current = true
  }, [threadId])

  useEffect(() => {
    if (!pendingBottomSnapRef.current) return
    if (isSwitchingThread || isHydratingActiveThread || messageCount === 0) return

    pendingBottomSnapRef.current = false
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToBottom('auto')
      })
    })
  }, [isSwitchingThread, isHydratingActiveThread, messageCount, scrollToBottom])

  useEffect(() => {
    syncBottomStateFromScroller()
  }, [messageCount, syncBottomStateFromScroller])

  useEffect(() => {
    const scroller = scrollerRef.current
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
  }, [getBottomMetrics, isStreaming, scheduleStickToBottom, syncBottomState, syncBottomStateFromScroller])

  useEffect(() => {
    if (!isStreaming) return

    const timer = window.setInterval(() => {
      if (atBottomRef.current) {
        stickToBottom()
      }
    }, 120)

    return () => window.clearInterval(timer)
  }, [isStreaming, stickToBottom])

  useEffect(() => {
    return () => {
      if (stickyFrameRef.current !== null) {
        cancelAnimationFrame(stickyFrameRef.current)
      }
    }
  }, [])

  return {
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
