import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Brain } from 'lucide-react'
import { Button } from '../ui'
import { useDecorativeAnimations } from '@/renderer/hooks/useDecorativeAnimations'
import { t } from '@shared/i18n'

interface ReasoningOption {
  value: string
  label: string
}

interface ReasoningParticleSliderProps {
  options: ReasoningOption[]
  value: string
  enabled: boolean
  language: 'en' | 'zh'
  onChange: (value: string) => void
  onCommit: () => void
}

interface ParticleSliderProps {
  index: number
  count: number
  label: string
  language: 'en' | 'zh'
  onIndexChange: (index: number) => void
  onCommit: () => void
}

interface FlowParticle {
  delay: number
  lane: number
  phase: number
  size: number
  speed: number
}

const PANEL_WIDTH = 224
const VIEWPORT_MARGIN = 10

const ParticleSlider = memo(function ParticleSlider({
  index,
  count,
  label,
  language,
  onIndexChange,
  onCommit,
}: ParticleSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previousIndexRef = useRef(index)
  const decorativeAnimations = useDecorativeAnimations()
  const progress = count > 1 ? index / (count - 1) : 0

  useEffect(() => {
    const previousIndex = previousIndexRef.current
    previousIndexRef.current = index
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const hasTransition = previousIndex !== index

    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    const bounds = canvas.getBoundingClientRect()
    const width = bounds.width
    const height = bounds.height
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)

    const thumbRadius = 10
    const availableWidth = width - thumbRadius * 2
    const fromProgress = count > 1 ? previousIndex / (count - 1) : 0
    const startX = thumbRadius + fromProgress * availableWidth
    const endX = thumbRadius + progress * availableWidth
    const direction = endX >= startX ? 1 : -1
    const centerY = height / 2
    const accent = getComputedStyle(canvas).color
    const particles: FlowParticle[] = Array.from({ length: 20 }, (_, particleIndex) => ({
      delay: (particleIndex % 7) * 0.018,
      lane: ((particleIndex * 7) % 17 - 8) / 8,
      phase: (particleIndex / 20) * Math.PI * 2,
      size: 0.55 + (particleIndex % 4) * 0.22,
      speed: 0.9 + (particleIndex % 5) * 0.035,
    }))
    const duration = 1150
    const startedAt = performance.now()
    const needsAmbient = decorativeAnimations && progress > 0
    let animationFrame = 0

    const easeInOutQuint = (value: number) => value < 0.5
      ? 16 * Math.pow(value, 5)
      : 1 - Math.pow(-2 * value + 2, 5) / 2

    const particlePosition = (particle: FlowParticle, local: number) => {
      const travel = easeInOutQuint(Math.min(1, Math.max(0, local * particle.speed)))
      const envelope = Math.sin(Math.PI * travel)
      const orbit = particle.phase + travel * Math.PI * 2.25 * direction
      return {
        x: startX + (endX - startX) * travel + Math.cos(orbit) * 2.8 * envelope,
        y: centerY + particle.lane * 2 + Math.sin(orbit) * (2.4 + Math.abs(particle.lane) * 1.7) * envelope,
        envelope,
      }
    }

    const draw = (now: number) => {
      const elapsedSeconds = (now - startedAt) / 1000
      const animationProgress = Math.min(1, (now - startedAt) / duration)
      const travelProgress = Math.min(1, animationProgress / 0.48)
      const fade = animationProgress < 0.72 ? 1 : Math.max(0, 1 - (animationProgress - 0.72) / 0.28)

      context.clearRect(0, 0, width, height)

      // Keep a quiet stream of particles alive across the entire selected area.
      // The canvas is clipped at the thumb center so nothing leaks into the inactive side.
      if (needsAmbient) {
        context.save()
        context.beginPath()
        context.rect(0, 0, endX, height)
        context.clip()
        context.globalCompositeOperation = 'lighter'
        for (let ambientIndex = 0; ambientIndex < 26; ambientIndex += 1) {
          const speed = 0.055 + (ambientIndex % 5) * 0.012
          const ambientProgress = (ambientIndex / 26 + elapsedSeconds * speed) % 1
          const x = 3 + ambientProgress * Math.max(1, endX - 5)
          const y = centerY
            + Math.sin(ambientIndex * 2.17 + elapsedSeconds * (0.65 + (ambientIndex % 4) * 0.12)) * (2.2 + (ambientIndex % 3))
          const size = 0.42 + (ambientIndex % 4) * 0.16
          const alpha = 0.2 + (ambientIndex % 5) * 0.045

          context.globalAlpha = alpha
          context.strokeStyle = ambientIndex % 4 === 0 ? 'rgba(255,255,255,0.88)' : accent
          context.lineWidth = Math.max(0.45, size * 0.55)
          context.beginPath()
          context.moveTo(x - 2.4, y)
          context.lineTo(x, y)
          context.stroke()

          context.fillStyle = ambientIndex % 4 === 0 ? 'rgba(255,255,255,0.94)' : accent
          context.shadowColor = accent
          context.shadowBlur = ambientIndex % 3 === 0 ? 2 : 0
          context.beginPath()
          context.arc(x, y, size, 0, Math.PI * 2)
          context.fill()
        }
        context.restore()
      }

      if (hasTransition && animationProgress < 1) {
        context.save()
        context.globalCompositeOperation = 'lighter'

        particles.forEach((particle, particleIndex) => {
          const local = (travelProgress - particle.delay) / (1 - particle.delay)
          if (local <= 0 || local >= 1) return
          const current = particlePosition(particle, local)
          const previous = particlePosition(particle, Math.max(0, local - 0.045))
          const visibility = Math.min(1, local * 7, (1 - local) * 7) * fade
          const isWhite = particleIndex % 5 === 0

          context.globalAlpha = visibility * 0.72
          context.strokeStyle = isWhite ? 'rgba(255,255,255,0.95)' : accent
          context.lineWidth = Math.max(0.5, particle.size * 0.65)
          context.shadowColor = accent
          context.shadowBlur = particleIndex % 3 === 0 ? 3 : 0
          context.beginPath()
          context.moveTo(previous.x, previous.y)
          context.quadraticCurveTo((previous.x + current.x) / 2, centerY + particle.lane * current.envelope, current.x, current.y)
          context.stroke()

          context.fillStyle = isWhite ? 'rgba(255,255,255,0.98)' : accent
          context.beginPath()
          context.arc(current.x, current.y, particle.size, 0, Math.PI * 2)
          context.fill()
        })

        if (animationProgress > 0.3 && fade > 0) {
          for (let spark = 0; spark < 8; spark += 1) {
            const sparkProgress = ((animationProgress - 0.3) * (2.8 + (spark % 3) * 0.35) + spark / 8) % 1
            const x = startX + (endX - startX) * sparkProgress
            const y = centerY + ((spark % 3) - 1) * 1.3 + Math.sin(sparkProgress * Math.PI * 3 + spark) * 0.6
            context.globalAlpha = fade * (0.35 + (1 - Math.abs(sparkProgress - 0.5) * 2) * 0.45)
            context.fillStyle = spark % 3 === 0 ? 'rgba(255,255,255,0.96)' : accent
            context.shadowColor = accent
            context.shadowBlur = 2
            context.beginPath()
            context.arc(x, y, spark % 3 === 0 ? 0.85 : 0.52, 0, Math.PI * 2)
            context.fill()
          }
        }

        context.restore()
      }

      // The ambient stream is a perpetual decoration; the transition burst is
      // not. With no ambient work left the loop has to end — otherwise this
      // canvas repaints 26 shadow-blurred, `lighter`-composited particles at
      // display rate for as long as the popover stays open.
      if (needsAmbient || (hasTransition && animationProgress < 1)) {
        animationFrame = requestAnimationFrame(draw)
      } else {
        context.clearRect(0, 0, width, height)
      }
    }

    animationFrame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animationFrame)
  }, [count, index, progress, decorativeAnimations])

  const updateFromPointer = useCallback((clientX: number) => {
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    const thumbRadius = 10
    const usableWidth = Math.max(1, rect.width - thumbRadius * 2)
    const pointerProgress = Math.min(1, Math.max(0, (clientX - rect.left - thumbRadius) / usableWidth))
    onIndexChange(Math.round(pointerProgress * Math.max(0, count - 1)))
  }, [count, onIndexChange])

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={t('reasoningParticleSlider.reasoningEffortParticleSlider', language)}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, count - 1)}
      aria-valuenow={index}
      aria-valuetext={label}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        const direction = event.key === 'ArrowRight' ? 1 : -1
        onIndexChange(Math.min(count - 1, Math.max(0, index + direction)))
      }}
      onKeyUp={onCommit}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        updateFromPointer(event.clientX)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event.clientX)
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        onCommit()
      }}
      className="relative h-6 cursor-pointer touch-none overflow-hidden rounded-full border border-border/35 bg-text-primary/[0.055] shadow-inner outline-none ring-accent/20 transition-shadow focus:ring-2"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-out"
        style={{
          width: `calc(10px + ${progress * 100}% - ${progress * 20}px)`,
          background: 'linear-gradient(90deg, rgb(var(--accent) / 0.56), rgb(var(--accent) / 0.76))',
          boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.16), 0 0 10px rgb(var(--accent) / 0.12)',
        }}
      />

      {Array.from({ length: count }, (_, markerIndex) => {
        const markerProgress = count > 1 ? markerIndex / (count - 1) : 0
        return (
          <span
            key={markerIndex}
            aria-hidden="true"
            className={`pointer-events-none absolute top-1/2 z-10 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full ${markerIndex <= index ? 'bg-white/75' : 'bg-text-muted/45'}`}
            style={{ left: `calc(10px + ${markerProgress * 100}% - ${markerProgress * 20}px)` }}
          />
        )
      })}

      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 z-20 h-5 w-5 -translate-y-1/2 rounded-full border border-accent/20 bg-background shadow-[0_2px_6px_rgba(0,0,0,0.16),0_0_0_1px_rgba(255,255,255,0.45)_inset] transition-[left] duration-300 ease-out"
        style={{ left: `calc(${progress * 100}% - ${progress * 20}px)` }}
      />

      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-30 h-full w-full text-accent"
      />
    </div>
  )
})

export default memo(function ReasoningParticleSlider({
  options,
  value,
  enabled,
  language,
  onChange,
  onCommit,
}: ReasoningParticleSliderProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value))
  const selectedLabel = options[selectedIndex]?.label ?? ''

  const updatePosition = useCallback(() => {
    const button = buttonRef.current
    if (!button) return
    const rect = button.getBoundingClientRect()
    const left = Math.min(window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, rect.right - PANEL_WIDTH))
    setPanelStyle({
      position: 'fixed',
      left,
      bottom: window.innerHeight - rect.top + 10,
      width: PANEL_WIDTH,
      zIndex: 9999,
    })
  }, [])

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

  useEffect(() => {
    if (!isOpen) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node
      if (!buttonRef.current?.contains(target) && !panelRef.current?.contains(target)) setIsOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [isOpen])

  const panel = isOpen && panelStyle
    ? createPortal(
      <div
        ref={panelRef}
        style={panelStyle}
        className="floating-surface rounded-xl border border-border/40 p-2.5 shadow-xl shadow-black/15 animate-scale-in"
      >
        <div className="mb-2 flex items-center justify-between gap-3 px-0.5">
          <span className="text-[10px] font-medium text-text-muted">
            {t('reasoningParticleSlider.reasoningEffort', language)}
          </span>
          <span className={`text-[10px] font-medium ${enabled ? 'text-accent' : 'text-text-muted'}`}>
            {selectedLabel}
          </span>
        </div>
        <ParticleSlider
          index={selectedIndex}
          count={options.length}
          label={selectedLabel}
          language={language}
          onIndexChange={(nextIndex) => {
            const option = options[nextIndex]
            if (option) onChange(option.value)
          }}
          onCommit={onCommit}
        />
      </div>,
      document.body,
    )
    : null

  return (
    <>
      <Button
        ref={buttonRef}
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen(open => !open)}
        title={t('reasoningParticleSlider.reasoningEffort2', language, { selectedLabel })}
        aria-label={t('reasoningParticleSlider.selectReasoningEffort', language)}
        aria-expanded={isOpen}
        className={`h-8 w-8 rounded-lg transition-all ${enabled ? 'text-accent hover:bg-accent/5' : 'text-text-muted hover:text-text-primary'}`}
      >
        <Brain className="h-4 w-4" />
      </Button>
      {panel}
    </>
  )
})
