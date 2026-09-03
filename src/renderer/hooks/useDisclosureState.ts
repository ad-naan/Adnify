import { useCallback, useEffect, useRef, useState } from 'react'
import { AGENT_DISCLOSURE_CLOSE_DELAY_MS } from '@renderer/agent/presentation/disclosureMotion'

interface UseDisclosureStateOptions {
  /** 有活内容时自动展开：正在跑、正在流、等审批、出错。 */
  openWhile?: boolean
  /** 按住已经自动展开的抽屉，不负责展开它。落下的那一刻才允许收起。 */
  holdOpenWhile?: boolean
  closeDelayMs?: number
}

export type DisclosureAction = 'open' | 'hold' | 'close' | 'idle'

/**
 * 自动展开的唯一判据，抽成纯函数是因为每个分支都对应时间轴上一次可见的高度变化。
 *
 * 关键是 `hold` 和 `close` 的分工：内容跑完时不立刻收（那会在下一行出现前先塌一次），
 * 而是按住到这一行不再是当前呈现的阶段 —— 也就是后继行挂载的那一刻 —— 再收。
 */
export function decideDisclosureAction({
  openWhile,
  holdOpenWhile,
  wasAutoOpen,
  userControlled,
}: {
  openWhile: boolean
  holdOpenWhile: boolean
  wasAutoOpen: boolean
  userControlled: boolean
}): DisclosureAction {
  if (userControlled) return 'idle'
  if (openWhile) return 'open'
  if (holdOpenWhile) return 'hold'
  return wasAutoOpen ? 'close' : 'idle'
}

/** One state machine for automatic disclosures. Explicit user choice wins. */
export function useDisclosureState({
  openWhile = false,
  holdOpenWhile = false,
  closeDelayMs = AGENT_DISCLOSURE_CLOSE_DELAY_MS,
}: UseDisclosureStateOptions) {
  const [isOpen, setIsOpen] = useState(openWhile)
  const previousAutoOpenRef = useRef(openWhile || holdOpenWhile)
  const userControlledRef = useRef(false)
  const closeTimerRef = useRef<number | null>(null)

  const clearPendingClose = useCallback(() => {
    if (closeTimerRef.current === null) return
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])

  const scheduleClose = useCallback(() => {
    clearPendingClose()
    // 交接式收起（delay 0）要落在触发它的那次提交里，绕一趟 setTimeout 就会晚一帧，
    // 后继行的入场动画已经开始了，一涨一缩就抵不掉。
    if (closeDelayMs <= 0) {
      setIsOpen(false)
      return
    }
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      setIsOpen(false)
    }, closeDelayMs)
  }, [clearPendingClose, closeDelayMs])

  useEffect(() => {
    const wasAutoOpen = previousAutoOpenRef.current
    previousAutoOpenRef.current = openWhile || holdOpenWhile

    switch (decideDisclosureAction({
      openWhile,
      holdOpenWhile,
      wasAutoOpen,
      userControlled: userControlledRef.current,
    })) {
      case 'open':
        clearPendingClose()
        setIsOpen(true)
        break
      case 'hold':
        clearPendingClose()
        break
      case 'close':
        scheduleClose()
        break
      case 'idle':
        break
    }
  }, [clearPendingClose, holdOpenWhile, openWhile, scheduleClose])

  useEffect(() => clearPendingClose, [clearPendingClose])

  const toggle = useCallback(() => {
    clearPendingClose()
    userControlledRef.current = true
    setIsOpen(current => !current)
  }, [clearPendingClose])

  const close = useCallback(() => {
    clearPendingClose()
    userControlledRef.current = true
    setIsOpen(false)
  }, [clearPendingClose])

  return { isOpen, toggle, close }
}
