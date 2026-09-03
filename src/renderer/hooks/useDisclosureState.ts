import { useCallback, useEffect, useRef, useState } from 'react'
import { AGENT_DISCLOSURE_CLOSE_DELAY_MS } from '@renderer/agent/presentation/disclosureMotion'

interface UseDisclosureStateOptions {
  openWhile?: boolean
  closeDelayMs?: number
  presentOnMount?: boolean
}

/** One state machine for automatic disclosures. Explicit user choice wins. */
export function useDisclosureState({
  openWhile = false,
  closeDelayMs = AGENT_DISCLOSURE_CLOSE_DELAY_MS,
  presentOnMount = false,
}: UseDisclosureStateOptions) {
  const initialPresentationRef = useRef(presentOnMount && !openWhile)
  const [isOpen, setIsOpen] = useState(openWhile || presentOnMount)
  const previousSignalRef = useRef(openWhile)
  const userControlledRef = useRef(false)
  const closeTimerRef = useRef<number | null>(null)

  const clearPendingClose = useCallback(() => {
    if (closeTimerRef.current === null) return
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])

  const scheduleClose = useCallback(() => {
    clearPendingClose()
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      setIsOpen(false)
    }, closeDelayMs)
  }, [clearPendingClose, closeDelayMs])

  useEffect(() => {
    const wasOpenWhile = previousSignalRef.current
    previousSignalRef.current = openWhile
    if (userControlledRef.current) return

    if (openWhile) {
      clearPendingClose()
      setIsOpen(true)
      return
    }

    if (wasOpenWhile) {
      scheduleClose()
    }
  }, [clearPendingClose, openWhile, scheduleClose])

  useEffect(() => {
    if (!initialPresentationRef.current || openWhile || userControlledRef.current) return
    scheduleClose()
    return clearPendingClose
  }, [clearPendingClose, openWhile, scheduleClose])

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
