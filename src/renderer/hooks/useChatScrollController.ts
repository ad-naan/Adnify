import { useCallback, useEffect, useRef, useState } from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'
import { AGENT_BOTTOM_FOLLOW_PAUSE_PADDING_MS, AGENT_DISCLOSURE_COLLAPSE_EVENT, AGENT_DISCLOSURE_COLLAPSE_MS, AGENT_DISCLOSURE_MANUAL_EVENT } from '@renderer/agent/presentation/disclosureMotion'
import { ChatViewport } from '@renderer/agent/presentation/chatViewport'

const CHAT_BOTTOM_THRESHOLD = 220

interface UseChatScrollControllerOptions {
  isHydratingActiveThread: boolean
  isSwitchingThread: boolean
  messageCount: number
  threadId: string | null
}

/** One owner for automatic scroll writes; Virtuoso owns virtualization only. */
export function useChatScrollController({
  isHydratingActiveThread, isSwitchingThread, messageCount, threadId,
}: UseChatScrollControllerOptions) {
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef(new ChatViewport())
  const frameRef = useRef<number | null>(null)
  const userIntentUntilRef = useRef(0)
  const pointerDownRef = useRef(false)
  const tailElementRef = useRef<HTMLDivElement | null>(null)
  const writtenTopRef = useRef<number | null>(null)
  const [scrollerElement, setScrollerElement] = useState<HTMLDivElement | null>(null)
  const [showScrollButton, setShowScrollButton] = useState(false)

  const writeGeometry = useCallback((top?: number, behavior: ScrollBehavior = 'auto') => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const viewport = viewportRef.current
    const tail = tailElementRef.current
    if (tail) {
      // Virtuoso's absolute viewport ignores scroller padding for scrollHeight.
      // This independent overflow box extends the range without entering its row measurements.
      tail.style.display = viewport.tail > 0 ? 'block' : 'none'
      tail.style.top = `${viewport.contentHeight}px`
      tail.style.height = `${viewport.tail}px`
    }
    if (top !== undefined && Math.abs(scroller.scrollTop - top) > 0.5) {
      writtenTopRef.current = top
      scroller.scrollTo({ top, behavior })
    }
    setShowScrollButton(!viewport.following && viewport.contentHeight > viewport.viewportHeight + 4)
  }, [])

  const commitLayout = useCallback((height?: number) => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const viewport = viewportRef.current
    const geometry = viewport.layout(height ?? viewport.contentHeight, scroller.clientHeight, performance.now())
    writeGeometry(geometry.scrollTop)
  }, [writeGeometry])

  const scrollToBottom = useCallback((behavior: 'auto' | 'smooth' = 'smooth') => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    // Explicit navigation is the only operation that discards the held tail.
    viewportRef.current.jumpToBottom()
    userIntentUntilRef.current = 0
    pointerDownRef.current = false
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      const scroller = scrollerRef.current
      if (!scroller) return
      const viewport = viewportRef.current
      viewport.viewportHeight = scroller.clientHeight
      viewport.jumpToBottom()
      writeGeometry(viewport.scrollTop, behavior)
    })
  }, [writeGeometry])

  const attachScrollerNode = useCallback((node: HTMLDivElement | null) => {
    if (scrollerRef.current === node) return
    tailElementRef.current?.remove()
    tailElementRef.current = null
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    scrollerRef.current = node
    if (node) {
      const tail = document.createElement('div')
      tail.setAttribute('aria-hidden', 'true')
      tail.dataset.chatScrollTail = ''
      tail.style.cssText = 'position:absolute;left:0;width:1px;pointer-events:none;display:none;'
      node.appendChild(tail)
      tailElementRef.current = tail
    }
    writtenTopRef.current = null
    viewportRef.current = new ChatViewport()
    userIntentUntilRef.current = 0
    pointerDownRef.current = false
    setScrollerElement(node)
    setShowScrollButton(false)
  }, [])

  // Initial thread positioning remains Virtuoso's initialTopMostItemIndex.
  // After send, measure the committed list rather than using a captured old index.
  useEffect(() => {
    if (isSwitchingThread || isHydratingActiveThread || messageCount === 0) return
    if (viewportRef.current.following) commitLayout()
  }, [commitLayout, isHydratingActiveThread, isSwitchingThread, messageCount, threadId])

  useEffect(() => {
    const scroller = scrollerElement
    if (!scroller) return
    const markIntent = () => { userIntentUntilRef.current = performance.now() + 500 }
    const onWheel = () => { pointerDownRef.current = false; markIntent() }
    const onPointerDown = () => { pointerDownRef.current = true; markIntent() }
    const onPointerUp = () => {
      if (pointerDownRef.current) markIntent()
      pointerDownRef.current = false
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) markIntent()
    }
    const onScroll = () => {
      if (writtenTopRef.current !== null && Math.abs(scroller.scrollTop - writtenTopRef.current) < 1) {
        writtenTopRef.current = null
        return
      }
      if (!pointerDownRef.current && performance.now() >= userIntentUntilRef.current) return
      markIntent()
      viewportRef.current.userScroll(scroller.scrollTop, CHAT_BOTTOM_THRESHOLD)
      writeGeometry()
    }
    const onCollapse = (event: Event) => {
      const duration = event instanceof CustomEvent ? Number(event.detail?.durationMs) || AGENT_DISCLOSURE_COLLAPSE_MS : AGENT_DISCLOSURE_COLLAPSE_MS
      viewportRef.current.beginCollapse(scroller.scrollTop, performance.now() + duration + AGENT_BOTTOM_FOLLOW_PAUSE_PADDING_MS)
    }
    const onManualDisclosure = () => {
      viewportRef.current.manualDisclosure(scroller.scrollTop, performance.now() + AGENT_DISCLOSURE_COLLAPSE_MS + AGENT_BOTTOM_FOLLOW_PAUSE_PADDING_MS)
      writeGeometry()
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    scroller.addEventListener('wheel', onWheel, { passive: true })
    scroller.addEventListener('touchmove', markIntent, { passive: true })
    scroller.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('pointerup', onPointerUp, { passive: true })
    scroller.addEventListener('keydown', onKeyDown)
    scroller.addEventListener(AGENT_DISCLOSURE_COLLAPSE_EVENT, onCollapse)
    scroller.addEventListener(AGENT_DISCLOSURE_MANUAL_EVENT, onManualDisclosure)
    const observer = new ResizeObserver(() => commitLayout())
    observer.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('wheel', onWheel)
      scroller.removeEventListener('touchmove', markIntent)
      scroller.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      scroller.removeEventListener('keydown', onKeyDown)
      scroller.removeEventListener(AGENT_DISCLOSURE_COLLAPSE_EVENT, onCollapse)
      scroller.removeEventListener(AGENT_DISCLOSURE_MANUAL_EVENT, onManualDisclosure)
      observer.disconnect()
    }
  }, [commitLayout, scrollerElement, writeGeometry])

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    // The ref detach owns the tail node. Effect cleanup also runs in StrictMode
    // without a DOM detach, so removing it here would lose the anchor on remount.
  }, [])

  return {
    atBottomThreshold: CHAT_BOTTOM_THRESHOLD,
    attachScrollerNode,
    handleTotalListHeightChanged: commitLayout,
    scrollToBottom,
    showScrollButton,
    virtuosoRef,
  }
}
