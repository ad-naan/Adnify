import { useCallback, useEffect, useRef, useState } from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'
import { AGENT_BOTTOM_FOLLOW_PAUSE_PADDING_MS, AGENT_DISCLOSURE_COLLAPSE_EVENT, AGENT_DISCLOSURE_COLLAPSE_MS } from '@renderer/agent/presentation/disclosureMotion'
import { reconcileCollapseCredit, resolveMaxCollapseCredit, retireCollapseCredit } from '@renderer/agent/presentation/collapseCredit'

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
  const animationFramesRef = useRef(new Set<number>())
  const bottomFollowPausedUntilRef = useRef(0)
  const listHeightRef = useRef(0)
  /** 收起开始那一刻的文档总高。有值就表示"正按着总高，让空间从底部出"。 */
  const heldTotalRef = useRef<number | null>(null)
  const collapseCreditRef = useRef(0)
  /** 按住期间 scrollTop 应有的值：万一浏览器先夹了一下，同一帧里写回去。 */
  const heldScrollTopRef = useRef<number | null>(null)
  const basePaddingBottomRef = useRef<number | null>(null)
  const [scrollerElement, setScrollerElement] = useState<HTMLDivElement | null>(null)
  const [showScrollButton, setShowScrollButton] = useState(false)

  const scheduleFrame = useCallback((callback: FrameRequestCallback) => {
    const frame = requestAnimationFrame(time => {
      animationFramesRef.current.delete(frame)
      callback(time)
    })
    animationFramesRef.current.add(frame)
    return frame
  }, [])

  const cancelFrame = useCallback((frame: number) => {
    cancelAnimationFrame(frame)
    animationFramesRef.current.delete(frame)
  }, [])

  const getBottomMetrics = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) {
      return {
        bottom: atBottomRef.current,
        distanceFromBottom: 0,
        hasOverflow: false,
      }
    }

    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    const hasOverflow = scroller.scrollHeight - scroller.clientHeight > 4
    const bottom = !hasOverflow || distanceFromBottom <= CHAT_BOTTOM_THRESHOLD

    return { bottom, distanceFromBottom, hasOverflow }
  }, [])

  /**
   * 把折叠余量写成容器的 padding-bottom。
   *
   * 只能在"高度已经变了、还没交给浏览器绘制"的同一次同步回调里写：晚一帧，scrollTop 已经被夹过，
   * 上面的内容就已经掉下去了。归零时把内联样式摘掉，免得压住 CSS 里原本的下内边距。
   */
  const writeCollapseCredit = useCallback((credit: number) => {
    const scroller = scrollerRef.current
    if (!scroller) return
    if (basePaddingBottomRef.current === null) {
      // 必须在第一次写之前读，否则读回来的是我们自己写的值。
      basePaddingBottomRef.current = Number.parseFloat(
        window.getComputedStyle(scroller).paddingBottom,
      ) || 0
    }

    collapseCreditRef.current = credit
    if (credit <= 0) {
      scroller.style.removeProperty('padding-bottom')
      return
    }
    scroller.style.paddingBottom = `${basePaddingBottomRef.current + credit}px`
  }, [])

  const releaseCollapseCredit = useCallback(() => {
    heldTotalRef.current = null
    heldScrollTopRef.current = null
    if (collapseCreditRef.current > 0) writeCollapseCredit(0)
  }, [writeCollapseCredit])

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
    // 用户点了"回到底部"，要的是真的底部：先把撑着的空白还掉，再滚。
    releaseCollapseCredit()

    scheduleFrame(() => {
      virtuosoRef.current?.scrollToIndex({
        index: messageCount - 1,
        align: 'end',
        behavior,
      })
      scheduleFrame(syncBottomStateFromScroller)
    })
  }, [messageCount, releaseCollapseCredit, scheduleFrame, syncBottomStateFromScroller])

  const stickToBottom = useCallback(() => {
    if (performance.now() < bottomFollowPausedUntilRef.current) return
    const scroller = scrollerRef.current
    if (!scroller || messageCount <= 0) return

    isAutoScrollingRef.current = true
    atBottomRef.current = true
    setShowScrollButton(false)

    // Virtuoso's followOutput handles ordinary list growth. This is only the
    // fallback for height changes inside the last row (streamed Markdown), so
    // write the scroll position once and let the next frame settle its state.
    scroller.scrollTop = scroller.scrollHeight

    scheduleFrame(() => {
      lastScrollTopRef.current = scroller.scrollTop
      isAutoScrollingRef.current = false
    })
  }, [messageCount, scheduleFrame])

  const scheduleStickToBottom = useCallback(() => {
    if (performance.now() < bottomFollowPausedUntilRef.current) return
    if (stickyFrameRef.current !== null) return
    stickyFrameRef.current = scheduleFrame(() => {
      stickyFrameRef.current = null
      if (performance.now() < bottomFollowPausedUntilRef.current) return
      stickToBottom()
    })
  }, [scheduleFrame, stickToBottom])

  const followOutput = useCallback((isListAtBottom: boolean) => {
    if (performance.now() < bottomFollowPausedUntilRef.current) return false
    return (isListAtBottom || atBottomRef.current) ? 'auto' : false
  }, [])

  const handleTotalListHeightChanged = useCallback((height: number) => {
    listHeightRef.current = height

    // 折叠余量必须跟高度变化落在同一次同步回调里（Virtuoso 开着
    // skipAnimationFrameInResizeObserver，这里就是那一次）。收起动画每一帧都会走到这儿：
    // 内容矮多少就补多少空白，总高按住不动 —— 上面的内容不动，让出的空间从底部出。
    if (heldTotalRef.current !== null) {
      const scroller = scrollerRef.current
      const credit = reconcileCollapseCredit({
        heldTotal: heldTotalRef.current,
        contentHeight: height,
        maxCredit: resolveMaxCollapseCredit(scroller?.clientHeight ?? 0),
      })
      if (credit !== collapseCreditRef.current) writeCollapseCredit(credit)

      if (credit <= 0) {
        // 新内容把空白吃完了，恢复"长高就往上推"。
        heldTotalRef.current = null
        heldScrollTopRef.current = null
      } else if (
        scroller
        && heldScrollTopRef.current !== null
        && Math.abs(scroller.scrollTop - heldScrollTopRef.current) > 1
      ) {
        // 浏览器可能在我们补上空白之前就夹了一次 scrollTop。总高已经按住，写回去是合法的，
        // 而且和这次高度变化同帧，屏幕上看不见中间态。
        isAutoScrollingRef.current = true
        scroller.scrollTop = heldScrollTopRef.current
        lastScrollTopRef.current = scroller.scrollTop
        scheduleFrame(() => {
          isAutoScrollingRef.current = false
        })
      }
    }

    // Virtuoso already publishes bottom intent using the same threshold below.
    // Reading scrollHeight here would force layout on every streamed row resize.
    if (!atBottomRef.current || performance.now() < bottomFollowPausedUntilRef.current) return

    setShowScrollButton(false)
    scheduleStickToBottom()
  }, [scheduleFrame, scheduleStickToBottom, writeCollapseCredit])

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
    // 换了节点，按住总高的那套账全部作废（下内边距也得重新量）。
    heldTotalRef.current = null
    heldScrollTopRef.current = null
    collapseCreditRef.current = 0
    basePaddingBottomRef.current = null
    listHeightRef.current = 0
    // The listener effect below has to follow the real DOM node, not just the
    // ref. Switching threads remounts Virtuoso and replaces the scroller, so a
    // ref-only update would leave the scroll listener and ResizeObserver bound
    // to the detached node and the new list would never hear about scrolling.
    setScrollerElement(node)
    if (!node) return

    scheduleFrame(() => {
      syncBottomStateFromScroller()
    })
  }, [scheduleFrame, syncBottomStateFromScroller])

  useEffect(() => {
    pendingBottomSnapRef.current = true
    // A new thread's list mounts pinned to its last row, so bottom is the
    // correct starting assumption. Carrying the previous thread's scrolled-up
    // state over would flash the jump-to-bottom button and make followOutput
    // refuse to follow until Virtuoso republishes its own bottom state.
    atBottomRef.current = true
    lastScrollTopRef.current = 0
    releaseCollapseCredit()
    setShowScrollButton(false)
  }, [releaseCollapseCredit, threadId])

  useEffect(() => {
    if (!pendingBottomSnapRef.current) return
    if (isSwitchingThread || isHydratingActiveThread || messageCount === 0) return

    pendingBottomSnapRef.current = false
    scheduleFrame(() => {
      scheduleFrame(() => {
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
  }, [getBottomMetrics, isSwitchingThread, isHydratingActiveThread, messageCount, scheduleFrame, scrollToBottom, syncBottomStateFromScroller])

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

      // 用户自己滚上去时，把底部撑着的空白还掉能还的那部分（还完 scrollTop 依然合法，
      // 屏幕上不会动）。往回翻历史就不会一直拖着一块空白。
      if (collapseCreditRef.current > 0) {
        const { distanceFromBottom } = getBottomMetrics()
        const nextCredit = retireCollapseCredit({
          credit: collapseCreditRef.current,
          distanceFromBottom,
        })
        if (nextCredit !== collapseCreditRef.current) {
          writeCollapseCredit(nextCredit)
          if (nextCredit <= 0) {
            heldTotalRef.current = null
            heldScrollTopRef.current = null
          } else {
            heldTotalRef.current = listHeightRef.current + nextCredit
            heldScrollTopRef.current = currentTop
          }
        }
      }

      // A disclosure deliberately reduces the last row's height. Treating that
      // resize as new streamed output pins the bottom edge and makes an upward
      // collapse look as if the whole card moved down.
      if (performance.now() < bottomFollowPausedUntilRef.current) return

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

    const handleDisclosureCollapse = (event: Event) => {
      const durationMs = event instanceof CustomEvent
        ? Number(event.detail?.durationMs) || AGENT_DISCLOSURE_COLLAPSE_MS
        : AGENT_DISCLOSURE_COLLAPSE_MS
      bottomFollowPausedUntilRef.current = performance.now() + durationMs + AGENT_BOTTOM_FOLLOW_PAUSE_PADDING_MS
      if (stickyFrameRef.current !== null) {
        cancelFrame(stickyFrameRef.current)
        stickyFrameRef.current = null
      }

      // 事件在收起动画开始前（useLayoutEffect）就到了，此刻的总高就是要按住的那个数。
      // 只在钉着底部时按：滚上去看历史的时候，收起本来就不会把可见内容往下拽。
      const { bottom, hasOverflow } = getBottomMetrics()
      if (!hasOverflow || !bottom) return
      if (resolveMaxCollapseCredit(scroller.clientHeight) <= 0) return
      heldTotalRef.current = listHeightRef.current + collapseCreditRef.current
      heldScrollTopRef.current = scroller.scrollTop
    }
    scroller.addEventListener(AGENT_DISCLOSURE_COLLAPSE_EVENT, handleDisclosureCollapse)

    let lastViewportHeight = scroller.clientHeight
    const resizeObserver = new ResizeObserver(() => {
      // 视口本身变了，按住总高的前提（clientHeight 不变）就不成立了，先还掉。
      if (scroller.clientHeight !== lastViewportHeight) {
        lastViewportHeight = scroller.clientHeight
        releaseCollapseCredit()
      }
      if (performance.now() < bottomFollowPausedUntilRef.current) return
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
      scroller.removeEventListener(AGENT_DISCLOSURE_COLLAPSE_EVENT, handleDisclosureCollapse)
      resizeObserver.disconnect()
    }
  }, [cancelFrame, getBottomMetrics, isStreaming, releaseCollapseCredit, scheduleStickToBottom, scrollerElement, syncBottomState, syncBottomStateFromScroller, writeCollapseCredit])

  useEffect(() => {
    return () => {
      animationFramesRef.current.forEach(frame => cancelAnimationFrame(frame))
      animationFramesRef.current.clear()
      stickyFrameRef.current = null
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
