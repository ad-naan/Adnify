import { useCallback, useEffect, useRef, useState } from 'react'
import { AGENT_DISCLOSURE_CLOSE_DELAY_MS } from '@renderer/agent/presentation/disclosureMotion'

interface UseDisclosureStateOptions {
  openWhile?: boolean
  closeDelayMs?: number
}

/** One state machine for automatic disclosures. Explicit user choice wins. */
export function useDisclosureState({
  openWhile = false,
  closeDelayMs = AGENT_DISCLOSURE_CLOSE_DELAY_MS,
}: UseDisclosureStateOptions) {
  const [isOpen, setIsOpen] = useState(openWhile)
  const previousSignalRef = useRef(openWhile)
  const userControlledRef = useRef(false)

  useEffect(() => {
    const wasOpenWhile = previousSignalRef.current
    previousSignalRef.current = openWhile
    if (userControlledRef.current) return

    if (openWhile) {
      setIsOpen(true)
      return
    }

    if (wasOpenWhile) {
      const timer = window.setTimeout(() => setIsOpen(false), closeDelayMs)
      return () => window.clearTimeout(timer)
    }
  }, [closeDelayMs, openWhile])

  const toggle = useCallback(() => {
    userControlledRef.current = true
    setIsOpen(current => !current)
  }, [])

  const close = useCallback(() => {
    userControlledRef.current = true
    setIsOpen(false)
  }, [])

  return { isOpen, toggle, close }
}
