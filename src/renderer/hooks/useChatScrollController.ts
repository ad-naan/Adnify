import { useCallback, useEffect, useRef, useState } from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'
import { AGENT_DISCLOSURE_MANUAL_EVENT } from '@renderer/agent/presentation/disclosureMotion'
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
  const writtenTopRef = useRef<number | null>(null)
  const [scrollerElement, setScrollerElement] = useState<HTMLDivElement | null>(null)
  const [showScrollButton, setShowScrollButton] = useState(false)

  const writeGeometry = useCallback((top?: number, behavior: ScrollBehavior = 'auto') => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const viewport = viewportRef.current
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
    const geometry = viewport.layout(height ?? viewport.contentHeight, scroller.clientHeight)
    writeGeometry(geometry.scrollTop)
  }, [writeGeometry])

  const scrollToBottom = useCallback((behavior: 'auto' | 'smooth' = 'smooth') => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
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
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    scrollerRef.current = node
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
    const onManualDisclosure = () => {
      viewportRef.current.manualDisclosure(scroller.scrollTop)
      commitLayout()
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    scroller.addEventListener('wheel', onWheel, { passive: true })
    scroller.addEventListener('touchmove', markIntent, { passive: true })
    scroller.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('pointerup', onPointerUp, { passive: true })
    scroller.addEventListener('keydown', onKeyDown)
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
      scroller.removeEventListener(AGENT_DISCLOSURE_MANUAL_EVENT, onManualDisclosure)
      observer.disconnect()
    }
  }, [commitLayout, scrollerElement, writeGeometry])

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
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
