/**
 * 面板拖拽调整大小 Hook
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { LAYOUT } from '@shared/constants'

type ResizeDirection = 'left' | 'right'

interface ResizeConfig {
  direction: ResizeDirection
  minSize: number
  maxSize: number
  onResize?: (size: number) => void
  onResizeEnd?: (size: number) => void
  panelRef?: React.RefObject<HTMLDivElement | null>
}

interface ResizeState {
  isResizing: boolean
  startResize: (e: React.MouseEvent) => void
}

export function useResizePanel(config: ResizeConfig): ResizeState {
  const [isResizing, setIsResizing] = useState(false)
  const lastSizeRef = useRef<number | null>(null)

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    document.body.style.cursor = 'col-resize'
  }, [])

  // 稳定化 config 引用
  const { direction, minSize, maxSize, onResize, onResizeEnd, panelRef } = config

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      // left: 从左边计算宽度，right: 从右边计算宽度
      const newSize = direction === 'left'
        ? e.clientX - LAYOUT.ACTIVITY_BAR_WIDTH
        : window.innerWidth - e.clientX

      if (newSize > minSize && newSize < maxSize) {
        lastSizeRef.current = newSize
        if (panelRef?.current) {
          panelRef.current.style.width = `${newSize}px`
        }
        if (onResize) {
          onResize(newSize)
        }
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.body.style.cursor = 'default'
      if (onResizeEnd && lastSizeRef.current !== null) {
        onResizeEnd(lastSizeRef.current)
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    // 遮罩层防止选中文本
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:col-resize'
    document.body.appendChild(overlay)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      document.body.removeChild(overlay)
    }
  }, [isResizing, direction, minSize, maxSize, onResize, onResizeEnd, panelRef])

  return { isResizing, startResize }
}

// 侧边栏 resize（从左边拖拽）
export function useSidebarResize(onResizeEnd: (width: number) => void, panelRef: React.RefObject<HTMLDivElement | null>) {
  const config = useMemo(() => ({
    direction: 'left' as const,
    minSize: LAYOUT.SIDEBAR_MIN_WIDTH,
    maxSize: LAYOUT.SIDEBAR_MAX_WIDTH,
    onResizeEnd,
    panelRef,
  }), [onResizeEnd, panelRef])

  return useResizePanel(config)
}

// 聊天面板 resize（从右边拖拽）
export function useChatResize(onResizeEnd: (width: number) => void, panelRef: React.RefObject<HTMLDivElement | null>) {
  const config = useMemo(() => ({
    direction: 'right' as const,
    minSize: LAYOUT.CHAT_MIN_WIDTH,
    maxSize: LAYOUT.CHAT_MAX_WIDTH,
    onResizeEnd,
    panelRef,
  }), [onResizeEnd, panelRef])

  return useResizePanel(config)
}
