import { useCallback, useEffect, useRef, useState } from 'react'
import { AGENT_DISCLOSURE_CLOSE_DELAY_MS, AGENT_DISCLOSURE_MANUAL_EVENT } from '@renderer/agent/presentation/disclosureMotion'

interface UseDisclosureStateOptions {
  /** Timeline-owned state. No local automatic timer when supplied. */
  automaticOpen?: boolean
  /** 有活内容时自动展开：正在跑、正在流、等审批、出错。 */
  openWhile?: boolean
  /**
   * 还不能收：这一行仍是时间轴当前呈现的阶段，没有后继行来接手。
   *
   * 收起是向下的（钉底的滚动容器里，一行变矮会把它上面的内容往下拽一段）。让它等后继阶段
   * 挂载再收，收和长就落在同一次提交里；配合滚动容器的"折叠余量"（按住文档总高），让出的
   * 空间从底部出，上面的内容不动。
   */
  holdOpen?: boolean
  /**
   * 自动展开的抽屉是否也自动收起。
   *
   * 默认收（用户要的就是"跑完自己折起来"）。传 false 表示这一类抽屉永远只由用户点着收。
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
  holdOpen,
  autoClose,
  wasAutoOpen,
  userControlled,
}: {
  openWhile: boolean
  holdOpen: boolean
  autoClose: boolean
  wasAutoOpen: boolean
  userControlled: boolean
}): DisclosureAction {
  if (userControlled) return 'idle'
  if (openWhile) return 'open'
  if (!wasAutoOpen) return 'idle'
  if (holdOpen) return 'hold'
  return autoClose ? 'close' : 'hold'
}

/** One state machine for automatic disclosures. Explicit user choice wins. */
export function useDisclosureState({
  automaticOpen,
  openWhile = false,
  holdOpen = false,
  autoClose = true,
  closeDelayMs = AGENT_DISCLOSURE_CLOSE_DELAY_MS,
}: UseDisclosureStateOptions) {
  const [isOpen, setIsOpen] = useState(automaticOpen ?? openWhile)
  /**
   * "自动展开过，且还没收" —— 粘住的状态，不是"上一次的 openWhile"。
   *
   * 交接式收起分两步到：先是这一行跑完（openWhile 落下），过一会儿后继阶段才挂载
   * （holdOpen 落下）。只记上一次的 openWhile 的话，第二步时已经忘了自己是自动展开的，
   * 于是永远停在展开态 —— 那正是"有的一直不展开/一直不收"的另一半。
   */
  const autoOpenedRef = useRef(openWhile)
  const [manualOpen, setManualOpen] = useState<boolean | undefined>(undefined)
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
    if (automaticOpen !== undefined) {
      clearPendingClose()
      return
    }
    switch (decideDisclosureAction({
      openWhile,
      holdOpen,
      autoClose,
      wasAutoOpen: autoOpenedRef.current,
      userControlled: manualOpen !== undefined,
    })) {
      case 'open':
        clearPendingClose()
        autoOpenedRef.current = true
        setIsOpen(true)
        break
      case 'hold':
        clearPendingClose()
        break
      case 'close':
        autoOpenedRef.current = false
        scheduleClose()
        break
      case 'idle':
        break
    }
  }, [automaticOpen, autoClose, clearPendingClose, holdOpen, openWhile, scheduleClose, manualOpen])

  useEffect(() => clearPendingClose, [clearPendingClose])

  const toggle = useCallback((event?: { currentTarget: EventTarget | null }) => {
    clearPendingClose()
    event?.currentTarget?.dispatchEvent(new CustomEvent(AGENT_DISCLOSURE_MANUAL_EVENT, { bubbles: true }))
    setManualOpen(!(manualOpen ?? automaticOpen ?? isOpen))
  }, [automaticOpen, clearPendingClose, isOpen, manualOpen])

  const close = useCallback(() => {
    clearPendingClose()
    setManualOpen(false)
  }, [clearPendingClose])

  return { isOpen: manualOpen ?? automaticOpen ?? isOpen, toggle, close }
}
