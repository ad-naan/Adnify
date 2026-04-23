import { useCallback, useEffect, useRef, useState } from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'

const CHAT_BOTTOM_THRESHOLD = 96

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

  const followOutput = useCallback((isListAtBottom: boolean) => {
    if (isStreaming) return isListAtBottom ? 'auto' : false
    return isListAtBottom ? 'auto' : false
  }, [isStreaming])

  const handleTotalListHeightChanged = useCallback(() => {
    if (!isStreaming) {
      requestAnimationFrame(syncBottomStateFromScroller)
      return
    }

    if (!atBottomRef.current) {
      requestAnimationFrame(syncBottomStateFromScroller)
      return
    }

    isAutoScrollingRef.current = true
    setShowScrollButton(false)

    requestAnimationFrame(() => {
      virtuosoRef.current?.autoscrollToBottom()
      requestAnimationFrame(() => {
        isAutoScrollingRef.current = false
        syncBottomStateFromScroller()
      })
    })
  }, [isStreaming, syncBottomStateFromScroller])

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
      syncBottomStateFromScroller()
    }

    handleScroll()
    scroller.addEventListener('scroll', handleScroll, { passive: true })

    const resizeObserver = new ResizeObserver(() => {
      syncBottomStateFromScroller()
    })
    resizeObserver.observe(scroller)

    return () => {
      scroller.removeEventListener('scroll', handleScroll)
      resizeObserver.disconnect()
    }
  }, [syncBottomStateFromScroller])

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
