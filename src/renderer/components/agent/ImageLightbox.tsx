import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '@store'
import { t } from '@/renderer/i18n'

interface ImageLightboxItem {
  src: string
  alt?: string
}

interface ImageLightboxProps {
  isOpen: boolean
  src?: string | null
  alt?: string
  images?: ImageLightboxItem[]
  initialIndex?: number
  onClose: () => void
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 4
const ZOOM_STEP = 0.2

export const ImageLightbox = memo(function ImageLightbox({
  isOpen,
  src,
  alt = 'Image preview',
  images,
  initialIndex = 0,
  onClose,
}: ImageLightboxProps) {
  const language = useStore((state) => state.language)
  const normalizedImages = useMemo<ImageLightboxItem[]>(() => {
    if (images && images.length > 0) return images
    return src ? [{ src, alt }] : []
  }, [images, src, alt])

  const [activeIndex, setActiveIndex] = useState(initialIndex)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    if (!isOpen) return
    setActiveIndex(initialIndex)
    setZoom(1)
  }, [isOpen, initialIndex])

  const currentImage = normalizedImages[activeIndex] || null
  const canNavigate = normalizedImages.length > 1

  const clampZoom = useCallback((value: number) => {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
  }, [])

  const zoomIn = useCallback(() => {
    setZoom((prev) => clampZoom(prev + ZOOM_STEP))
  }, [clampZoom])

  const zoomOut = useCallback(() => {
    setZoom((prev) => clampZoom(prev - ZOOM_STEP))
  }, [clampZoom])

  const resetZoom = useCallback(() => {
    setZoom(1)
  }, [])

  const showPrev = useCallback(() => {
    if (!canNavigate) return
    setActiveIndex((prev) => (prev - 1 + normalizedImages.length) % normalizedImages.length)
    setZoom(1)
  }, [canNavigate, normalizedImages.length])

  const showNext = useCallback(() => {
    if (!canNavigate) return
    setActiveIndex((prev) => (prev + 1) % normalizedImages.length)
    setZoom(1)
  }, [canNavigate, normalizedImages.length])

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        showPrev()
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        showNext()
        return
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        zoomIn()
        return
      }
      if (event.key === '-') {
        event.preventDefault()
        zoomOut()
        return
      }
      if (event.key === '0') {
        event.preventDefault()
        resetZoom()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, resetZoom, showNext, showPrev, zoomIn, zoomOut])

  if (!isOpen || !currentImage) return null

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-950/28 backdrop-blur-md p-6 md:p-8"
        onClick={onClose}
        style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        <motion.div
          initial={{ scale: 0.96, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.96, opacity: 0 }}
          className="relative flex h-full w-full items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          {canNavigate && (
            <button
              onClick={showPrev}
              className="absolute left-3 md:left-6 top-1/2 -translate-y-1/2 z-[100000] rounded-2xl border border-white/10 bg-black/45 p-3 text-white shadow-lg backdrop-blur-md transition-all hover:bg-black/65 hover:border-white/20"
              aria-label="Previous image"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}

          <div className="relative flex max-h-full max-w-full items-center justify-center overflow-hidden rounded-2xl">
            <img
              src={currentImage.src}
              alt={currentImage.alt || alt}
              className="max-h-[88vh] max-w-[88vw] select-none object-contain shadow-2xl transition-transform duration-200 ease-out"
              style={{ transform: `scale(${zoom})` }}
              onWheel={(event) => {
                event.preventDefault()
                const delta = event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP
                setZoom((prev) => clampZoom(prev + delta))
              }}
              onDoubleClick={() => {
                setZoom((prev) => (prev > 1 ? 1 : 2))
              }}
              draggable={false}
            />
          </div>

          {canNavigate && (
            <button
              onClick={showNext}
              className="absolute right-3 md:right-6 top-1/2 -translate-y-1/2 z-[100000] rounded-2xl border border-white/10 bg-black/45 p-3 text-white shadow-lg backdrop-blur-md transition-all hover:bg-black/65 hover:border-white/20"
              aria-label="Next image"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          )}

          <div className="absolute top-4 left-1/2 z-[100000] -translate-x-1/2">
            <div className="flex items-center gap-1.5 rounded-2xl border border-white/10 bg-black/45 px-2 py-2 text-white shadow-lg backdrop-blur-md">
              <button
                onClick={zoomOut}
                className="rounded-xl p-2.5 transition-all hover:bg-white/10"
                aria-label="Zoom out"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                onClick={zoomIn}
                className="rounded-xl p-2.5 transition-all hover:bg-white/10"
                aria-label="Zoom in"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <div className="mx-1 h-5 w-px bg-white/10" />
              <button
                onClick={resetZoom}
                className="min-w-[52px] rounded-xl px-2.5 py-2 text-xs font-medium text-white/85 transition-all hover:bg-white/10"
                aria-label="Reset zoom"
              >
                {Math.round(zoom * 100)}%
              </button>
              <div className="mx-1 h-5 w-px bg-white/10" />
              <button
                onClick={onClose}
                className="rounded-xl p-2.5 transition-all hover:bg-white/10"
                aria-label="Close image preview"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="absolute bottom-4 left-1/2 z-[100000] -translate-x-1/2 rounded-full bg-black/45 px-4 py-2 text-xs text-white shadow-lg backdrop-blur-md">
            {canNavigate ? (
              <span className="opacity-90">
                {activeIndex + 1} / {normalizedImages.length}
              </span>
            ) : (
              <span className="opacity-75">{t('imagePreview.zoomHint', language)}</span>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
})
