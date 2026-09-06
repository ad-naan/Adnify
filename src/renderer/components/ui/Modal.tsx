import React, { memo, useMemo } from 'react'
import { X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useEscapeKey } from '@/renderer/hooks/usePerformance'
import { useElevatedToastLayer } from '@/renderer/components/common/toastLayerStore'
import { DecorativeAnimationScope } from '@/renderer/components/common/DecorativeAnimationScope'

interface ModalProps {
    isOpen: boolean
    onClose: () => void
    title?: string
    children: React.ReactNode
    size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | 'full'
    noPadding?: boolean
    className?: string
    showCloseButton?: boolean
    disableGlassEffect?: boolean
    enableGlassEffect?: boolean
    scrollable?: boolean
}

const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    '4xl': 'max-w-4xl',
    '5xl': 'max-w-5xl',
    'full': 'max-w-full mx-4 h-[90vh]'
}

export const Modal: React.FC<ModalProps> = memo(function Modal({
    isOpen,
    onClose,
    title,
    children,
    size = 'md',
    noPadding = false,
    className = '',
    showCloseButton = true,
    disableGlassEffect = false,
    enableGlassEffect = false,
    scrollable = true,
}) {
    useEscapeKey(onClose, isOpen)
    useElevatedToastLayer(isOpen)

    const sizeClass = useMemo(() => sizes[size], [size])
    const useGlassEffect = enableGlassEffect && !disableGlassEffect

    if (!isOpen) return null

    return createPortal(
        <DecorativeAnimationScope className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 overlay-scrim modal-backdrop-enter"
                onClick={onClose}
            />

            {/* Modal Content */}
            <div
                className={`
                    relative w-full ${sizeClass} 
                    ${useGlassEffect ? 'floating-surface' : 'modal-surface'}
                    border border-border/50 
                    rounded-3xl
                    overflow-hidden 
                    flex flex-col modal-panel-enter ${className}
                `}
            >
                {title && (
                    <div className={`${useGlassEffect ? 'floating-surface-header' : 'modal-surface-header'} relative flex items-center justify-between px-6 py-5 border-b border-border/50 z-10 shrink-0`}>
                        <h3 className="text-lg font-bold text-text-primary tracking-tight">{title}</h3>
                        {showCloseButton && (
                            <button onClick={onClose} className="p-2 rounded-xl hover:bg-text-primary/[0.05] text-text-muted hover:text-text-primary transition-all duration-200 group">
                                <X className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
                            </button>
                        )}
                    </div>
                )}

                <div className={`relative z-10 ${scrollable ? 'custom-scrollbar overflow-auto' : 'overflow-hidden'} ${noPadding ? '' : 'p-6'} flex-1`}>
                    {children}
                </div>
            </div>
        </DecorativeAnimationScope>,
        document.body
    )
})
