import { useStore } from '@/renderer/store'
import { useInlineToast } from './InlineToast'
import { motion, AnimatePresence } from 'framer-motion'
import { Volume2 } from 'lucide-react'

export default function GlobalToastContainer() {
  const { toasts, visibleIds } = useInlineToast()

  // Select logic for ejection
  const {
    showSettings,
    showCommandPalette,
    showComposer,
    showQuickOpen,
    showAbout,
    workspace,
  } = useStore()

  const hasModal = showSettings || showCommandPalette || showComposer || showQuickOpen || showAbout
  const hasWorkspace = workspace && workspace.roots.length > 0

  // Eject condition: either a modal is covering the screen, or the workspace (and thus StatusBar) is not present
  const shouldEject = hasModal || !hasWorkspace

  const latestVisibleToastId = visibleIds[visibleIds.length - 1]
  const activeToast = latestVisibleToastId ? toasts.find((t) => t.id === latestVisibleToastId) : null

  return (
    <div className="fixed top-12 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none flex flex-col items-center justify-start">
      <AnimatePresence mode="wait">
        {shouldEject && activeToast && (
          <motion.div
            layoutId="adnify-dynamic-island"
            key={activeToast.id}
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className="flex items-center gap-2 px-3 py-1.5 bg-background-secondary/80 backdrop-blur-md border border-border/50 rounded-full shadow-lg pointer-events-auto cursor-pointer max-w-[400px]"
          >
            <Volume2
              className={`w-3.5 h-3.5 animate-pulse shrink-0 ${
                activeToast.type === 'success'
                  ? 'text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.6)]'
                  : activeToast.type === 'error'
                  ? 'text-red-400 drop-shadow-[0_0_6px_rgba(248,113,113,0.6)]'
                  : activeToast.type === 'warning'
                  ? 'text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.6)]'
                  : 'text-blue-400 drop-shadow-[0_0_6px_rgba(96,165,250,0.6)]'
              }`}
            />
            <span className="text-xs text-text-primary font-medium truncate">
              {activeToast.message}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
