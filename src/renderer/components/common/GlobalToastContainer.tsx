import { useStore } from '@/renderer/store'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useInlineToast } from './InlineToast'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowUpRight, Terminal, Volume2, X } from 'lucide-react'
import { useHasElevatedToastLayer, useToastAnchor } from './toastLayerStore'
import { useViewportRect } from './useViewportRect'
import { Button } from '../ui'
import { OtterAsset } from '@/renderer/components/brand/OtterAsset'
import type { ToastType } from './InlineToast'
import type { OtterAssetKey } from '@/renderer/components/brand/otterAssets'

const toastAssetByType: Record<ToastType, OtterAssetKey> = {
  success: 'toastSuccess',
  error: 'toastError',
  warning: 'toastWarning',
  info: 'toastInfo',
}

export default function GlobalToastContainer() {
  const { toasts, visibleIds, dismissToast } = useInlineToast()
  const hasElevatedToastLayer = useHasElevatedToastLayer()
  const hasWorkspace = useStore((state) => (state.workspace?.roots.length ?? 0) > 0)
  const anchor = useToastAnchor()
  const anchorRect = useViewportRect(anchor)
  const [cardElement, setCardElement] = useState<HTMLDivElement | null>(null)
  const cardRect = useViewportRect(cardElement)

  const shouldEject = hasElevatedToastLayer || !hasWorkspace || !anchor

  const visibleToasts = visibleIds
    .map((id) => toasts.find((toast) => toast.id === id) || null)
    .filter((toast): toast is NonNullable<typeof toast> => toast !== null)
  const activeInlineToast = [...visibleToasts].reverse().find((toast) => toast.variant === 'inline') || null
  const activeCardToast = [...visibleToasts].reverse().find((toast) => toast.variant === 'card') || null

  const target = shouldEject
    ? {
        right: 12,
        bottom: 36 + ((cardRect?.height || 0) > 0 ? cardRect!.height + 8 : 0),
        width: Math.min(window.innerWidth - 24, Math.max(240, anchorRect?.width || 320)),
      }
    : {
        right: Math.max(0, (anchorRect?.viewportWidth || window.innerWidth) - (anchorRect?.right || window.innerWidth)),
        bottom: Math.max(0, (anchorRect?.viewportHeight || window.innerHeight) - (anchorRect?.bottom || window.innerHeight)),
        width: anchorRect?.width || 0,
      }

  return createPortal(
    <>
        <AnimatePresence>
          {activeInlineToast && (shouldEject || target.width > 0) && (
            <motion.div
              key="inline-toast"
              data-inline-toast
              data-toast-placement={shouldEject ? 'floating' : 'docked'}
              role="status"
              initial={{ ...target, opacity: 0 }}
              animate={{ ...target, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className={`fixed z-[9999] flex items-center gap-1.5 overflow-hidden pointer-events-none ${shouldEject ? 'rounded-full border border-border/50 bg-background-secondary/95 px-3 py-1.5 shadow-lg backdrop-blur-md' : 'h-6 px-1'}`}
            >
              <Volume2 className="h-3.5 w-3.5 shrink-0 text-text-muted" />
              <span className={`${shouldEject ? 'text-xs' : 'text-[10.5px]'} text-text-primary font-medium truncate`}>
                {activeInlineToast.message}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

      <div ref={setCardElement} className="fixed right-3 bottom-9 z-[9500] pointer-events-none">
        <AnimatePresence mode="wait">
          {activeCardToast && (
            <motion.div
              key={activeCardToast.id}
              initial={{ opacity: 0, x: 18, scale: 0.985 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 12, scale: 0.99 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              className="pointer-events-auto w-[292px] max-w-[calc(100vw-1rem)] rounded-[16px] border border-border/70 bg-background-secondary shadow-[0_14px_32px_-24px_rgba(0,0,0,0.5)]"
            >
              <div className="relative p-3">
                <button
                  onClick={() => dismissToast(activeCardToast.id)}
                  className="absolute top-2.5 right-2.5 rounded-md p-1 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
                >
                  <X className="w-3.5 h-3.5" />
                </button>

                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-surface text-text-muted">
                    <OtterAsset asset={toastAssetByType[activeCardToast.type]} className="h-6 w-6 object-contain" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 pr-6 text-[10px] text-text-muted">
                      {activeCardToast.source && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-surface px-1.5 py-0.5 text-[9px] font-medium text-text-muted">
                          <Terminal className="h-2.5 w-2.5" />
                          {activeCardToast.source}
                        </span>
                      )}
                    </div>

                    {activeCardToast.title && (
                      <h3 className="mt-1 text-[13px] font-semibold text-text-primary">
                        {activeCardToast.title}
                      </h3>
                    )}
                    {activeCardToast.message && (
                      <p className="mt-1 text-[11px] leading-4.5 text-text-secondary">
                        {activeCardToast.message}
                      </p>
                    )}
                  </div>
                </div>

                {activeCardToast.actions && activeCardToast.actions.length > 0 && (
                  <div className="mt-3 flex items-center justify-end gap-1.5">
                    {activeCardToast.actions.map((action) => (
                      <Button
                        key={action.id}
                        onClick={() => action.onClick?.()}
                        variant={action.style === 'primary' ? 'primary' : action.style === 'ghost' ? 'ghost' : 'secondary'}
                        size="sm"
                        className="h-7 rounded-lg px-2.5 text-[11px]"
                        rightIcon={action.style === 'primary' ? <ArrowUpRight className="h-3 w-3" /> : undefined}
                      >
                        {action.label}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>, document.body
  )
}
