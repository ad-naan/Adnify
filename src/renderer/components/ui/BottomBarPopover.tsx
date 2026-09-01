import {
    CSSProperties,
    memo,
    ReactNode,
    useCallback,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useClickOutside, useEscapeKey } from '@/renderer/hooks/usePerformance'

export interface BottomBarPopoverProps {
    icon: ReactNode
    tooltip?: string
    title?: string
    children: ReactNode
    width?: number
    height?: number
    scrollable?: boolean
    onOpenChange?: (isOpen: boolean) => void
}

const VIEWPORT_MARGIN = 12
const TRIGGER_GAP = 10
const HEADER_HEIGHT = 44

export default memo(function BottomBarPopover({
    icon,
    tooltip,
    title,
    children,
    width = 400,
    height,
    scrollable = true,
    onOpenChange,
}: BottomBarPopoverProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null)
    const popoverRef = useRef<HTMLDivElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)

    const handleClose = useCallback(() => {
        setIsOpen(false)
        onOpenChange?.(false)
    }, [onOpenChange])
    const handleToggle = useCallback(() => {
        setIsOpen(prev => {
            const next = !prev
            onOpenChange?.(next)
            return next
        })
    }, [onOpenChange])

    useClickOutside(handleClose, isOpen, [popoverRef, buttonRef])
    useEscapeKey(handleClose, isOpen)

    const updatePosition = useCallback(() => {
        if (!buttonRef.current) return

        const triggerRect = buttonRef.current.getBoundingClientRect()
        const maxWidth = Math.max(240, window.innerWidth - VIEWPORT_MARGIN * 2)
        const resolvedWidth = Math.min(width, maxWidth)
        const maxHeight = Math.max(160, triggerRect.top - VIEWPORT_MARGIN - TRIGGER_GAP)
        const resolvedHeight = height === undefined ? undefined : Math.min(height, maxHeight)

        let left = triggerRect.right - resolvedWidth
        left = Math.min(Math.max(left, VIEWPORT_MARGIN), window.innerWidth - resolvedWidth - VIEWPORT_MARGIN)

        setPanelStyle({
            position: 'fixed',
            left,
            bottom: Math.max(window.innerHeight - triggerRect.top + TRIGGER_GAP, VIEWPORT_MARGIN),
            width: resolvedWidth,
            maxHeight,
            ...(resolvedHeight !== undefined ? { height: resolvedHeight } : {}),
            transformOrigin: `${Math.min(Math.max(triggerRect.right - left, 24), resolvedWidth - 24)}px bottom`,
        })
    }, [height, width])

    useLayoutEffect(() => {
        if (!isOpen) return

        updatePosition()
        window.addEventListener('resize', updatePosition)
        window.addEventListener('scroll', updatePosition, true)

        return () => {
            window.removeEventListener('resize', updatePosition)
            window.removeEventListener('scroll', updatePosition, true)
        }
    }, [isOpen, updatePosition])

    const contentStyle = useMemo<CSSProperties>(() => {
        if (!panelStyle) return {}

        const maxHeight = typeof panelStyle.maxHeight === 'number'
            ? panelStyle.maxHeight - (title ? HEADER_HEIGHT : 0)
            : undefined

        if (height !== undefined) {
            return { height: Math.max(0, Math.min(height - (title ? HEADER_HEIGHT : 0), maxHeight ?? height)) }
        }

        return maxHeight === undefined ? {} : { maxHeight }
    }, [height, panelStyle, title])

    const panel = isOpen && panelStyle ? createPortal(
        <div
            ref={popoverRef}
            className="floating-surface fixed z-[1000] overflow-hidden rounded-lg border border-border/50 shadow-2xl shadow-black/20 animate-slide-up"
            style={panelStyle}
        >
            {title && (
                <div className="floating-surface-header flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border/50 px-4">
                    <span className="min-w-0 truncate text-[11px] font-bold uppercase tracking-wider text-text-muted">
                        {title}
                    </span>
                    <button
                        onClick={handleClose}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-white/10 hover:text-text-primary"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            )}

            <div
                className={scrollable ? 'min-h-0 overflow-auto custom-scrollbar' : 'min-h-0 overflow-hidden'}
                style={contentStyle}
            >
                {children}
            </div>
        </div>,
        document.body,
    ) : null

    return (
        <div className="relative flex items-center">
            <button
                ref={buttonRef}
                onClick={handleToggle}
                className={`
                    relative flex items-center justify-center rounded p-1.5 transition-colors
                    ${isOpen
                        ? 'bg-accent/20 text-accent'
                        : 'text-text-muted hover:bg-surface-hover hover:text-text-primary'
                    }
                `}
                title={tooltip}
            >
                {icon}
            </button>

            {panel}
        </div>
    )
})

if (typeof document !== 'undefined' && !document.getElementById('bottom-bar-popover-style')) {
    const style = document.createElement('style')
    style.id = 'bottom-bar-popover-style'
    style.textContent = `
      @keyframes slide-up {
        from {
          opacity: 0;
          transform: translateY(8px) scale(0.98);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
      .animate-slide-up {
        animation: slide-up 0.15s ease-out;
      }
    `
    document.head.appendChild(style)
}
