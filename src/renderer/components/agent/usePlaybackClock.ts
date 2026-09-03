import { useEffect, useRef, useState } from 'react'

const BASE_CHARACTERS_PER_SECOND = 48
const MAX_SPEED_MULTIPLIER = 4
/**
 * 追赶模式的字速倍率（≈1150 字/秒）。
 *
 * 时间轴落后实时界面太多、或者用户被审批卡着的时候用：可见时间轴在还没露完的文字那儿就断了，
 * 后面的工具行挂不上来 —— 托盘已经在说"有暂存文件、等你审批"，卡片却还在等打字机。
 * 一段几百字的正文用这个速度半秒内收尾，落后量就有了上限。
 */
const CATCH_UP_SPEED_MULTIPLIER = 24
const OCCLUDED_FRAME_FALLBACK_MS = 100

function safeEnd(text: string, end: number): number {
  if (end <= 0 || end >= text.length) return end
  const previous = text.charCodeAt(end - 1)
  return previous >= 0xd800 && previous <= 0xdbff ? end + 1 : end
}

function firstCharacter(text: string): string {
  return text.slice(0, safeEnd(text, 1))
}

/** The assistant timeline's only requestAnimationFrame-driven character clock. */
export function usePlaybackClock(target: string, enabled: boolean, catchUp = false) {
  const [visibleText, setVisibleText] = useState(() => enabled ? firstCharacter(target) : target)
  const visibleRef = useRef(visibleText)
  const targetRef = useRef(target)
  const hasStartedRef = useRef(enabled)
  const frameRef = useRef<number | null>(null)
  const fallbackRef = useRef<number | null>(null)
  const lastFrameRef = useRef(0)
  const budgetRef = useRef(0)
  // 自转的 tick 每帧读它，所以倍率一变下一帧就生效，不用重排循环。
  const catchUpRef = useRef(catchUp)
  catchUpRef.current = catchUp

  const clearFallback = () => {
    if (fallbackRef.current === null) return
    window.clearTimeout(fallbackRef.current)
    fallbackRef.current = null
  }

  const tick = (now: number) => {
    const currentLength = visibleRef.current.length
    const backlog = targetRef.current.length - currentLength
    if (backlog <= 0) {
      lastFrameRef.current = 0
      budgetRef.current = 0
      return
    }

    const elapsed = lastFrameRef.current ? Math.min(now - lastFrameRef.current, 80) : 16
    lastFrameRef.current = now
    const speed = catchUpRef.current
      ? BASE_CHARACTERS_PER_SECOND * CATCH_UP_SPEED_MULTIPLIER
      : BASE_CHARACTERS_PER_SECOND * (1 + Math.min(backlog / 56, MAX_SPEED_MULTIPLIER - 1))
    budgetRef.current += elapsed / 1000 * speed

    const count = Math.min(Math.floor(budgetRef.current), backlog)
    if (count > 0) {
      budgetRef.current -= count
      const end = safeEnd(targetRef.current, currentLength + count)
      const next = targetRef.current.slice(0, end)
      visibleRef.current = next
      setVisibleText(next)
    }

    schedule()
  }

  const schedule = () => {
    if (
      frameRef.current !== null
      || fallbackRef.current !== null
      || visibleRef.current.length >= targetRef.current.length
    ) return

    frameRef.current = window.requestAnimationFrame(now => {
      frameRef.current = null
      clearFallback()
      tick(now)
    })
    fallbackRef.current = window.setTimeout(() => {
      fallbackRef.current = null
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      tick(performance.now())
    }, OCCLUDED_FRAME_FALLBACK_MS)
  }

  useEffect(() => {
    targetRef.current = target
    if (enabled) hasStartedRef.current = true

    if (!hasStartedRef.current) {
      visibleRef.current = target
      setVisibleText(target)
      return
    }

    if (!target.startsWith(visibleRef.current)) {
      const next = enabled ? firstCharacter(target) : target
      visibleRef.current = next
      setVisibleText(next)
      budgetRef.current = 0
      lastFrameRef.current = 0
    }

    schedule()
  }, [enabled, target])

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    clearFallback()
    lastFrameRef.current = 0
  }, [])

  return visibleText
}
