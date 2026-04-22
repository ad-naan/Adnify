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
  const lastAutoScrollAtRef = useRef(0)
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
    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({
        index: messageCount - 1,
        align: 'end',
        behavior,
      })
    })
    syncBottomState(true, false)
  }, [messageCount, syncBottomState])

  const followOutput = useCallback((isListAtBottom: boolean) => {
    if (isStreaming) return isListAtBottom ? 'smooth' : false
    return isListAtBottom ? 'auto' : false
  }, [isStreaming])

  const handleTotalListHeightChanged = useCallback(() => {
    const { bottom } = getBottomMetrics()
    if (!bottom || !isStreaming) {
      syncBottomStateFromScroller()
      return
    }

    const now = Date.now()
    if (now - lastAutoScrollAtRef.current < 120) return

    lastAutoScrollAtRef.current = now
    isAutoScrollingRef.current = true
    virtuosoRef.current?.autoscrollToBottom()

    setTimeout(() => {
      isAutoScrollingRef.current = false
      syncBottomStateFromScroller()
    }, 50)
  }, [getBottomMetrics, isStreaming, syncBottomStateFromScroller])

  const handleBottomStateChange = useCallback((bottom: boolean) => {
    if (isAutoScrollingRef.current) return

    const { hasOverflow } = getBottomMetrics()
    syncBottomState(bottom, hasOverflow)
  }, [getBottomMetrics, syncBottomState])

  const isRangeAtBottom = useCallback((range: VisibleRange) => {
    const lastIndex = messageCount - 1
    return lastIndex <= 0 || range.endIndex >= lastIndex
  }, [messageCount])

  const handleVisibleRangeChanged = useCallback((range: VisibleRange) => {
    if (isAutoScrollingRef.current) return

    const bottom = isRangeAtBottom(range)
    if (bottom !== atBottomRef.current || !bottom) {
      const { hasOverflow } = getBottomMetrics()
      syncBottomState(bottom, hasOverflow)
    }
  }, [getBottomMetrics, isRangeAtBottom, syncBottomState])

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
