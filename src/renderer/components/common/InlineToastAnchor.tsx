import { Volume2 } from 'lucide-react'
import { useInlineToast } from './InlineToast'
import { setToastAnchor } from './toastLayerStore'

/** Reserve the dock's final size; the single visible capsule is rendered in the body portal. */
export default function InlineToastAnchor() {
  const { toasts, visibleIds } = useInlineToast()
  const active = [...visibleIds].reverse().map(id => toasts.find(toast => toast.id === id)).find(toast => toast?.variant === 'inline')
  return <span ref={setToastAnchor} aria-hidden="true" data-toast-anchor className="pointer-events-none flex h-6 min-w-0 max-w-[320px] items-center overflow-hidden opacity-0">
    {active && <span className="flex items-center gap-1.5 whitespace-nowrap px-1">
      <Volume2 className="h-3.5 w-3.5 shrink-0" />
      <span className="max-w-[260px] truncate text-[10.5px] font-medium">{active.message}</span>
    </span>}
  </span>
}
