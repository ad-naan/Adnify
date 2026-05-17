/**
 * 底部栏弹出框公共组件
 * 在底部状态栏显示图标，点击后向上展开一个面板
 */

import { useState, useRef, useCallback, ReactNode, memo, useMemo } from 'react'
import { X } from 'lucide-react'
import { useClickOutside, useEscapeKey } from '@/renderer/hooks/usePerformance'

export interface BottomBarPopoverProps {
    /** 触发按钮的图标 */
    icon: ReactNode
    /** 按钮提示文字 */
    tooltip?: string
    /** 面板标题 */
    title?: string
    /** 面板内容 */
    children: ReactNode
    /** 面板宽度 */
    width?: number
    /** 面板高度；不传时自适应内容 */
    height?: number
    /** 角标内容（如数量） */
    badge?: string | number
    /** 语言 */
    language?: 'en' | 'zh'
    /** 内容区域是否滚动 */
    scrollable?: boolean
}

export default memo(function BottomBarPopover({
    icon,
    tooltip,
    title,
    children,
    width = 400,
    height,
    badge,
    scrollable = true,
}: BottomBarPopoverProps) {
    const [isOpen, setIsOpen] = useState(false)
    const popoverRef = useRef<HTMLDivElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)

    const handleClose = useCallback(() => setIsOpen(false), [])
    const handleToggle = useCallback(() => setIsOpen(prev => !prev), [])

    // 使用 useClickOutside 处理点击外部关闭，需要排除按钮和弹框本身
    useClickOutside(handleClose, isOpen, [popoverRef, buttonRef])
    // 使用 useEscapeKey 处理 ESC 键关闭
    useEscapeKey(handleClose, isOpen)

    const contentHeight = useMemo(() => {
        if (height === undefined) return undefined
        return title ? Math.max(0, height - 44) : height
    }, [title, height])

    return (
        <div className="relative">
            {/* 触发按钮 */}
            <button
                ref={buttonRef}
                onClick={handleToggle}
                className={`
          flex items-center justify-center p-1.5 rounded
          transition-colors relative
          ${isOpen
                        ? 'bg-accent/20 text-accent'
                        : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
                    }
        `}
                title={tooltip}
            >
                {icon}
                {badge !== undefined && (
                    <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] flex items-center justify-center px-0.5 text-[9px] font-medium bg-accent text-white rounded-full">
                        {badge}
                    </span>
                )}
            </button>

            {/* 弹出面板 */}
            {isOpen && (
                <div
                    ref={popoverRef}
                    className="floating-surface absolute bottom-full right-0 mb-3 border border-border/50 rounded-2xl overflow-hidden animate-slide-up z-50 origin-bottom-right"
                    style={{ width, ...(height !== undefined ? { height } : {}) }}
                >
                    {/* 面板头部 */}
                    {title && (
                        <div className="floating-surface-header flex items-center justify-between px-4 py-3 border-b border-border/50 z-10 shrink-0">
                            <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider">{title}</span>
                            <button
                                onClick={handleClose}
                                className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-white/10 transition-colors"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    )}

                    {/* 面板内容 */}
                    <div
                        className={scrollable ? 'overflow-auto custom-scrollbar' : 'overflow-hidden'}
                        style={contentHeight !== undefined ? { height: contentHeight } : undefined}
                    >
                        {children}
                    </div>
                </div>
            )}
        </div>
    )
})

// 添加动画样式
const style = document.createElement('style')
style.textContent = `
  @keyframes slide-up {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  .animate-slide-up {
    animation: slide-up 0.15s ease-out;
  }
`
if (typeof document !== 'undefined' && !document.getElementById('bottom-bar-popover-style')) {
    style.id = 'bottom-bar-popover-style'
    document.head.appendChild(style)
}
