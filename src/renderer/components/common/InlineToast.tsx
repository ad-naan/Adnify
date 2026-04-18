import { useState, useCallback, createContext, useContext, ReactNode } from 'react'

export type ToastType = 'success' | 'error' | 'warning' | 'info'
export type ToastVariant = 'inline' | 'card'

export interface ToastAction {
  id: string
  label: string
  style?: 'primary' | 'secondary' | 'ghost'
  onClick?: () => void
}

export interface ToastMessage {
  id: string
  type: ToastType
  variant: ToastVariant
  title?: string
  message: string
  duration?: number
  timestamp: number
  source?: string
  dedupeKey?: string
  actions?: ToastAction[]
}

interface ShowCardOptions {
  type?: ToastType
  title: string
  message: string
  actions?: ToastAction[]
  duration?: number
  source?: string
  dedupeKey?: string
}

interface ToastContextType {
  toasts: ToastMessage[]
  visibleIds: string[]
  addToast: (type: ToastType, message: string, durationOrDetail?: number | string) => string
  showCard: (options: ShowCardOptions) => string
  removeToast: (id: string) => void
  dismissToast: (id: string) => void
  success: (message: string, durationOrDetail?: number | string) => string
  error: (message: string, durationOrDetail?: number | string) => string
  warning: (message: string, durationOrDetail?: number | string) => string
  info: (message: string, durationOrDetail?: number | string) => string
}

const ToastContext = createContext<ToastContextType | null>(null)

function createToastId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function InlineToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [visibleIds, setVisibleIds] = useState<string[]>([])

  const scheduleDismiss = useCallback((id: string, duration: number) => {
    if (duration <= 0) {
      return
    }

    setTimeout(() => {
      setVisibleIds((prev) => prev.filter((visibleId) => visibleId !== id))
    }, duration)
  }, [])

  const addToast = useCallback((type: ToastType, message: string, durationOrDetail?: number | string) => {
    const id = createToastId('toast')
    let finalMessage = message
    let duration = 5000

    if (typeof durationOrDetail === 'string' && durationOrDetail) {
      finalMessage = `${message}: ${durationOrDetail}`
    } else if (typeof durationOrDetail === 'number') {
      duration = durationOrDetail
    }

    const newToast: ToastMessage = {
      id,
      type,
      variant: 'inline',
      message: finalMessage,
      duration,
      timestamp: Date.now(),
    }

    setToasts((prev) => {
      const updated = prev.length >= 50 ? prev.slice(1) : prev
      return [...updated, newToast]
    })

    setVisibleIds((prev) => {
      const newIds = [...prev, id]
      return newIds.length > 5 ? newIds.slice(-5) : newIds
    })

    scheduleDismiss(id, duration)
    return id
  }, [scheduleDismiss])

  const showCard = useCallback((options: ShowCardOptions) => {
    const existingToast = options.dedupeKey
      ? toasts.find((toast) => toast.dedupeKey === options.dedupeKey)
      : null

    if (existingToast) {
      setToasts((prev) => prev.map((toast) => (
        toast.id === existingToast.id
          ? {
              ...toast,
              ...options,
              variant: 'card',
              timestamp: Date.now(),
              actions: options.actions,
            }
          : toast
      )))

      setVisibleIds((prev) => (
        prev.includes(existingToast.id) ? prev : [...prev, existingToast.id]
      ))

      scheduleDismiss(existingToast.id, options.duration ?? 0)
      return existingToast.id
    }

    const id = createToastId('card')
    const newToast: ToastMessage = {
      id,
      type: options.type || 'info',
      variant: 'card',
      title: options.title,
      message: options.message,
      duration: options.duration ?? 0,
      timestamp: Date.now(),
      source: options.source,
      dedupeKey: options.dedupeKey,
      actions: options.actions,
    }

    setToasts((prev) => {
      const updated = prev.length >= 50 ? prev.slice(1) : prev
      return [...updated, newToast]
    })

    setVisibleIds((prev) => [...prev.filter((visibleId) => visibleId !== id), id])
    scheduleDismiss(id, newToast.duration ?? 0)
    return id
  }, [scheduleDismiss, toasts])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
    setVisibleIds((prev) => prev.filter((visibleId) => visibleId !== id))
  }, [])

  const dismissToast = useCallback((id: string) => {
    setVisibleIds((prev) => prev.filter((visibleId) => visibleId !== id))
  }, [])

  const success = useCallback((message: string, durationOrDetail?: number | string) => addToast('success', message, durationOrDetail), [addToast])
  const error = useCallback((message: string, durationOrDetail?: number | string) => addToast('error', message, durationOrDetail), [addToast])
  const warning = useCallback((message: string, durationOrDetail?: number | string) => addToast('warning', message, durationOrDetail), [addToast])
  const info = useCallback((message: string, durationOrDetail?: number | string) => addToast('info', message, durationOrDetail), [addToast])

  return (
    <ToastContext.Provider value={{ toasts, visibleIds, addToast, showCard, removeToast, dismissToast, success, error, warning, info }}>
      {children}
    </ToastContext.Provider>
  )
}

export function useInlineToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useInlineToast must be used within InlineToastProvider')
  }
  return context
}

let globalToast: ToastContextType | null = null

export function setGlobalInlineToast(toast: ToastContextType) {
  globalToast = toast
}

export const toast = {
  success: (message: string, durationOrDetail?: number | string) => globalToast?.success(message, durationOrDetail),
  error: (message: string, durationOrDetail?: number | string) => globalToast?.error(message, durationOrDetail),
  warning: (message: string, durationOrDetail?: number | string) => globalToast?.warning(message, durationOrDetail),
  info: (message: string, durationOrDetail?: number | string) => globalToast?.info(message, durationOrDetail),
  card: (options: ShowCardOptions) => globalToast?.showCard(options),
  dismiss: (id: string) => globalToast?.dismissToast(id),
  remove: (id: string) => globalToast?.removeToast(id),
}
