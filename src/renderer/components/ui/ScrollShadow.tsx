/**
 * ScrollShadow 组件
 * 
 * 带上下虚拟阴影的滚动容器，隐藏滚动条
 * 当内容可滚动时自动显示渐变阴影效果
 */

import { useRef, useState, useEffect, ReactNode } from 'react'

interface ScrollShadowProps {
  children: ReactNode
  className?: string
  maxHeight?: string
  showScrollbar?: boolean
}

export function ScrollShadow({ 
  children, 
  className = '', 
  maxHeight = '400px',
  showScrollbar = false 
}: ScrollShadowProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showTopShadow, setShowTopShadow] = useState(false)
  const [showBottomShadow, setShowBottomShadow] = useState(false)

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return

    const { scrollTop, scrollHeight, clientHeight } = el
    
    // 顶部阴影：滚动超过 5px 时显示
    setShowTopShadow(scrollTop > 5)
    
    // 底部阴影：距离底部超过 5px 时显示
    setShowBottomShadow(scrollTop + clientHeight < scrollHeight - 5)
  }

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    // 初始检查
    handleScroll()

    // 监听滚动
    el.addEventListener('scroll', handleScroll)
    
    // 监听内容变化（使用 ResizeObserver）
    const resizeObserver = new ResizeObserver(handleScroll)
    resizeObserver.observe(el)

    return () => {
      el.removeEventListener('scroll', handleScroll)
      resizeObserver.disconnect()
    }
  }, [children])

  const topMask = showTopShadow ? 'transparent 0%, black 24px' : 'black 0%, black 24px'
  const bottomMask = showBottomShadow ? 'black calc(100% - 24px), transparent 100%' : 'black calc(100% - 24px), black 100%'
  const maskImage = `linear-gradient(to bottom, ${topMask}, ${bottomMask})`

  return (
    <div 
      className={`relative ${className}`}
      style={{
        WebkitMaskImage: maskImage,
        maskImage: maskImage,
      }}
    >
      {/* 滚动容器 */}
      <div
        ref={scrollRef}
        className={`overflow-y-auto ${showScrollbar ? '' : 'scrollbar-none'} h-full w-full`}
        style={{ maxHeight }}
      >
        {children}
      </div>
    </div>
  )
}
