import { useCallback, useEffect, useRef, useState } from 'react'
import { AGENT_DISCLOSURE_CLOSE_DELAY_MS } from '@renderer/agent/presentation/disclosureMotion'

interface UseDisclosureStateOptions {
  /** 有活内容时自动展开：正在跑、正在流、等审批、出错。 */
  openWhile?: boolean
  /**
   * 自动展开的抽屉是否也自动收起。
   *
   * 时间轴上的行要传 false。收起是向下的：钉在底部的滚动容器里，一行变矮会把它上面的
   * 所有内容往下拽一段（浏览器把 scrollTop 夹回去）。自动展开再自动收起就是一涨一缩，
   * 幅度等于抽屉里那坨内容的高度 —— 用户看到的"内容上下摆动"就是它。
   * 单向只涨读起来是时间轴在长，人能接受；来回动不行。
   */
  autoClose?: boolean
  closeDelayMs?: number
}

export type DisclosureAction = 'open' | 'hold' | 'close' | 'idle'

/**
 * 自动展开的唯一判据，抽成纯函数是因为每个分支都对应时间轴上一次可见的高度变化。
 */
export function decideDisclosureAction({
  openWhile,
  autoClose,
  wasAutoOpen,
  userControlled,
}: {
  openWhile: boolean
  autoClose: boolean
  wasAutoOpen: boolean
  userControlled: boolean
}): DisclosureAction {
  if (userControlled) return 'idle'
  if (openWhile) return 'open'
  if (!wasAutoOpen) return 'idle'
  return autoClose ? 'close' : 'hold'
}

/** One state machine for automatic disclosures. Explicit user choice wins. */
export function useDisclosureState({
  openWhile = false,
  autoClose = true,
  closeDelayMs = AGENT_DISCLOSURE_CLOSE_DELAY_MS,
}: UseDisclosureStateOptions) {
  const [isOpen, setIsOpen] = useState(openWhile)
  const previousAutoOpenRef = useRef(openWhile)
  const userControlledRef = useRef(false)
  const closeTimerRef = useRef<number | null>(null)

  const clearPendingClose = useCallback(() => {
    if (closeTimerRef.current === null) return
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])

  const scheduleClose = useCallback(() => {
    clearPendingClose()
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
    previousAutoOpenRef.current = openWhile

    switch (decideDisclosureAction({
      openWhile,
      autoClose,
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
  }, [autoClose, clearPendingClose, openWhile, scheduleClose])

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
