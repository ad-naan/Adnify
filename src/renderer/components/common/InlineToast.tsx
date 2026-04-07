import { useState, useCallback, createContext, useContext, ReactNode } from 'react'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastMessage {
  id: string
  type: ToastType
  message: string
  duration?: number
  timestamp: number
}

interface ToastContextType {
  toasts: ToastMessage[] // History
  visibleIds: string[] // Active current items
  addToast: (type: ToastType, message: string, durationOrDetail?: number | string) => string
  removeToast: (id: string) => void // Clears from history completely
  dismissToast: (id: string) => void // Only dismisses from the current visible queue
  success: (message: string, durationOrDetail?: number | string) => string
  error: (message: string, durationOrDetail?: number | string) => string
  warning: (message: string, durationOrDetail?: number | string) => string
  info: (message: string, durationOrDetail?: number | string) => string
}

const ToastContext = createContext<ToastContextType | null>(null)


// Removed ToastContainer and QueueToast as StatusBar handles presentation natively now.


// Provider
export function InlineToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [visibleIds, setVisibleIds] = useState<string[]>([])

  const addToast = useCallback((type: ToastType, message: string, durationOrDetail?: number | string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`
    let finalMessage = message
    let duration = 5000 // 默认延长到 5s 方便阅读长内容
    if (typeof durationOrDetail === 'string' && durationOrDetail) {
      finalMessage = `${message}: ${durationOrDetail}`
    } else if (typeof durationOrDetail === 'number') {
      duration = durationOrDetail
    }

    const newToast: ToastMessage = { id, type, message: finalMessage, duration, timestamp: Date.now() }

    // 加入历史记录
    setToasts((prev) => {
      const updated = prev.length >= 50 ? prev.slice(1) : prev
      return [...updated, newToast]
    })

    // 加入可见队列
    setVisibleIds((prev) => {
      const newIds = [...prev, id]
      return newIds.length > 5 ? newIds.slice(-5) : newIds
    })

    // 自动清理可见队列
    if (duration > 0) {
      setTimeout(() => {
        setVisibleIds((prev) => prev.filter((vId) => vId !== id))
      }, duration)
    }

    return id
  }, [])

  // 彻底从历史中删除（供通知中心使用）
  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    setVisibleIds((prev) => prev.filter((vId) => vId !== id))
  }, [])

  // 仅从屏幕上隐藏（自动超时或用户点击关闭）
  const dismissToast = useCallback((id: string) => {
    setVisibleIds((prev) => prev.filter((vId) => vId !== id))
  }, [])

  const success = useCallback((message: string, durationOrDetail?: number | string) => addToast('success', message, durationOrDetail), [addToast])
  const error = useCallback((message: string, durationOrDetail?: number | string) => addToast('error', message, durationOrDetail), [addToast])
  const warning = useCallback((message: string, durationOrDetail?: number | string) => addToast('warning', message, durationOrDetail), [addToast])
  const info = useCallback((message: string, durationOrDetail?: number | string) => addToast('info', message, durationOrDetail), [addToast])

  return (
    <ToastContext.Provider value={{ toasts, visibleIds, addToast, removeToast, dismissToast, success, error, warning, info }}>
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

// 全局实例
let globalToast: ToastContextType | null = null

export function setGlobalInlineToast(toast: ToastContextType) {
  globalToast = toast
}

export const toast = {
  success: (message: string, durationOrDetail?: number | string) => globalToast?.success(message, durationOrDetail),
  error: (message: string, durationOrDetail?: number | string) => globalToast?.error(message, durationOrDetail),
  warning: (message: string, durationOrDetail?: number | string) => globalToast?.warning(message, durationOrDetail),
  info: (message: string, durationOrDetail?: number | string) => globalToast?.info(message, durationOrDetail),
}