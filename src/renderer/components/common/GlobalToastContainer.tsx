import { useStore } from '@/renderer/store'
import { useInlineToast } from './InlineToast'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowUpRight, Terminal, Volume2, X } from 'lucide-react'
import { useHasElevatedToastLayer } from './toastLayerStore'
import { Button } from '../ui'

export default function GlobalToastContainer() {
  const { toasts, visibleIds, dismissToast } = useInlineToast()
  const hasElevatedToastLayer = useHasElevatedToastLayer()
  const hasWorkspace = useStore((state) => (state.workspace?.roots.length ?? 0) > 0)

  const shouldEject = hasElevatedToastLayer || !hasWorkspace

  const visibleToasts = visibleIds
    .map((id) => toasts.find((toast) => toast.id === id) || null)
    .filter((toast): toast is NonNullable<typeof toast> => toast !== null)
  const activeInlineToast = [...visibleToasts].reverse().find((toast) => toast.variant === 'inline') || null
  const activeCardToast = [...visibleToasts].reverse().find((toast) => toast.variant === 'card') || null

  return (
    <>
      <div className="fixed top-12 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none flex flex-col items-center justify-start">
        <AnimatePresence mode="wait">
          {shouldEject && activeInlineToast && (
            <motion.div
              layoutId="adnify-dynamic-island"
              key={activeInlineToast.id}
              initial={{ opacity: 0, y: -20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              className="flex items-center gap-2 px-3 py-1.5 bg-background-secondary/80 backdrop-blur-md border border-border/50 rounded-full shadow-lg pointer-events-auto cursor-pointer max-w-[400px]"
            >
              <Volume2
                className={`w-3.5 h-3.5 animate-pulse shrink-0 ${
                  activeInlineToast.type === 'success'
                    ? 'text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.6)]'
                    : activeInlineToast.type === 'error'
                    ? 'text-red-400 drop-shadow-[0_0_6px_rgba(248,113,113,0.6)]'
                    : activeInlineToast.type === 'warning'
                    ? 'text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.6)]'
                    : 'text-blue-400 drop-shadow-[0_0_6px_rgba(96,165,250,0.6)]'
                }`}
              />
              <span className="text-xs text-text-primary font-medium truncate">
                {activeInlineToast.message}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="fixed right-3 bottom-9 z-[9500] pointer-events-none">
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
                    <Volume2 className="h-3.5 w-3.5" />
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
    </>
  )
}
