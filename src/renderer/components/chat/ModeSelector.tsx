import { useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import type { WorkMode } from '@/renderer/modes/types'
import { useStore } from '@store'

interface ModeSelectorProps {
  mode: WorkMode
  onModeChange: (mode: WorkMode) => void
  className?: string
}

const MODE_OPTIONS: Array<{ id: WorkMode; label: string }> = [
  { id: 'agent', label: 'Agent' },
  { id: 'plan', label: 'Plan' },
]

interface FlowParticle {
  delay: number
  lane: number
  phase: number
  depth: number
  size: number
  speed: number
}

/** A persistent two-position switch. The mascot remains a separate panel control. */
export default function ModeSelector({ mode, onModeChange, className = '' }: ModeSelectorProps) {
  const language = useStore(s => s.language)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previousMode = useRef<WorkMode>(mode)

  useEffect(() => {
    const fromMode = previousMode.current
    if (fromMode === mode) return
    previousMode.current = mode

    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const bounds = canvas.getBoundingClientRect()
    const width = bounds.width
    const height = bounds.height
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)

    const direction = mode === 'plan' ? 1 : -1
    const startX = mode === 'plan' ? width * 0.25 : width * 0.75
    const endX = mode === 'plan' ? width * 0.75 : width * 0.25
    const filamentStartX = mode === 'plan' ? width * 0.39 : width * 0.61
    const filamentEndX = mode === 'plan' ? width * 0.61 : width * 0.39
    const centerY = height / 2
    const accent = getComputedStyle(canvas).color
    const particles: FlowParticle[] = Array.from({ length: 18 }, (_, index) => ({
      delay: (index % 6) * 0.018,
      lane: ((index * 7) % 17 - 8) / 8,
      phase: (index / 18) * Math.PI * 2,
      depth: 0.62 + ((index * 11) % 9) / 14,
      size: 0.55 + (index % 4) * 0.22,
      speed: 0.9 + (index % 5) * 0.035,
    }))

    const startedAt = performance.now()
    let animationFrame = 0
    const duration = 1650
    const travelEnd = 0.34
    const holdEnd = 0.82

    const easeInOutQuint = (value: number) => value < 0.5
      ? 16 * Math.pow(value, 5)
      : 1 - Math.pow(-2 * value + 2, 5) / 2

    const particlePosition = (particle: FlowParticle, local: number) => {
      const travel = easeInOutQuint(Math.min(1, Math.max(0, local * particle.speed)))
      const envelope = Math.sin(Math.PI * travel)
      const orbit = particle.phase + travel * Math.PI * 2.4 * direction
      const depth = 0.78 + Math.cos(orbit) * 0.22
      const x = startX + (endX - startX) * travel + Math.cos(orbit) * 2.6 * envelope
      const y = centerY + particle.lane * 2.1 + Math.sin(orbit) * (2.5 + Math.abs(particle.lane) * 1.8) * envelope
      return { x, y, depth, travel, envelope }
    }

    const draw = (now: number) => {
      const elapsed = (now - startedAt) / duration
      const progress = Math.min(1, elapsed)
      const travelProgress = Math.min(1, progress / travelEnd)
      const eased = easeInOutQuint(travelProgress)
      const holdFade = progress < travelEnd
        ? Math.sin((progress / travelEnd) * Math.PI * 0.5)
        : progress < holdEnd
          ? 1
          : Math.max(0, 1 - (progress - holdEnd) / (1 - holdEnd))

      context.clearRect(0, 0, width, height)
      context.save()
      context.globalCompositeOperation = 'lighter'

      // A thin optical filament connects both states without turning into a flash.
      if (progress > 0.025) {
        const intensity = holdFade
        const gradient = context.createLinearGradient(filamentStartX, centerY, filamentEndX, centerY)
        gradient.addColorStop(0, 'rgba(99,102,241,0)')
        gradient.addColorStop(0.25, 'rgba(124,58,237,0.78)')
        gradient.addColorStop(0.5, 'rgba(217,70,239,0.92)')
        gradient.addColorStop(0.75, 'rgba(124,58,237,0.78)')
        gradient.addColorStop(1, 'rgba(99,102,241,0)')
        context.globalAlpha = intensity * (progress < travelEnd ? 0.28 : 0.58)
        context.strokeStyle = gradient
        context.lineWidth = 0.7
        context.shadowColor = 'rgba(139,92,246,0.75)'
        context.shadowBlur = 2.5
        context.beginPath()
        context.moveTo(filamentStartX, centerY)
        context.lineTo(width * 0.45, centerY - 1.1)
        context.lineTo(width * 0.49, centerY + 0.8)
        context.lineTo(width * 0.54, centerY - 0.7)
        context.lineTo(filamentEndX, centerY)
        context.stroke()

        // Fine secondary strands keep the states visibly connected without
        // turning the switch into a large flash.
        for (let strand = 0; strand < 2; strand++) {
          const offset = strand === 0 ? -1.15 : 1.15
          context.globalAlpha = intensity * 0.36
          context.lineWidth = 0.48
          context.beginPath()
          context.moveTo(filamentStartX + 1, centerY)
          context.bezierCurveTo(width * 0.46, centerY + offset, width * 0.54, centerY - offset, filamentEndX - 1, centerY)
          context.stroke()
        }

        // A compact constellation of nodes and short branches makes the
        // transition read as a particle connection instead of a divider line.
        const anchors = [0.14, 0.32, 0.5, 0.69, 0.86].map((position, index) => ({
          x: filamentStartX + (filamentEndX - filamentStartX) * position,
          y: centerY + Math.sin(index * 2.17 + progress * 5) * 1.35,
        }))
        context.strokeStyle = 'rgba(139,92,246,0.82)'
        context.fillStyle = 'rgba(192,132,252,0.96)'
        context.shadowColor = 'rgba(139,92,246,0.7)'
        context.shadowBlur = 2
        anchors.forEach((anchor, index) => {
          const branchDirection = index % 2 === 0 ? -1 : 1
          context.globalAlpha = intensity * 0.42
          context.lineWidth = 0.46
          context.beginPath()
          context.moveTo(anchor.x, anchor.y)
          context.lineTo(anchor.x + direction * 2.4, anchor.y + branchDirection * (2.2 + (index % 3) * 0.55))
          context.stroke()

          context.globalAlpha = intensity * (index === 2 ? 0.88 : 0.62)
          context.beginPath()
          context.arc(anchor.x, anchor.y, index === 2 ? 0.95 : 0.62, 0, Math.PI * 2)
          context.fill()
        })
        context.shadowBlur = 0
      }

      particles.forEach((particle, index) => {
        const local = (travelProgress - particle.delay) / (1 - particle.delay)
        if (local <= 0 || local >= 1) return
        const current = particlePosition(particle, local)
        const previous = particlePosition(particle, Math.max(0, local - 0.035))
        const visibility = Math.min(1, local * 7, (1 - local) * 7)
        const radius = particle.size * current.depth

        context.globalAlpha = visibility * (0.25 + current.depth * 0.48)
        context.strokeStyle = index % 5 === 0 ? 'rgba(255,255,255,0.9)' : accent
        context.lineWidth = Math.max(0.45, radius * 0.62)
        context.shadowColor = accent
        context.shadowBlur = current.depth > 0.92 ? 3 : 0
        context.beginPath()
        context.moveTo(previous.x, previous.y)
        context.quadraticCurveTo(
          (previous.x + current.x) / 2,
          centerY + particle.lane * current.envelope,
          current.x,
          current.y,
        )
        context.stroke()

        context.fillStyle = index % 5 === 0 ? 'rgba(255,255,255,0.96)' : accent
        context.beginPath()
        context.arc(current.x, current.y, radius, 0, Math.PI * 2)
        context.fill()
        context.shadowBlur = 0
      })

      // Once the slider arrives, a handful of sparks continue moving through
      // the filament so the connection remains alive for a short beat.
      if (progress >= travelEnd && holdFade > 0) {
        for (let spark = 0; spark < 9; spark++) {
          const phase = ((progress - travelEnd) * (3.2 + (spark % 3) * 0.45) + spark / 9) % 1
          const x = filamentStartX + (filamentEndX - filamentStartX) * phase
          const lane = (spark % 3) - 1
          const wave = lane * 1.2 + Math.sin(phase * Math.PI * 3 + spark) * 0.65
          const radius = spark % 3 === 0 ? 0.82 : 0.5
          context.globalAlpha = holdFade * (0.38 + (1 - Math.abs(phase - 0.5) * 2) * 0.42)
          context.fillStyle = spark % 3 === 0 ? 'rgba(255,255,255,0.96)' : 'rgba(168,85,247,0.9)'
          context.shadowColor = 'rgba(139,92,246,0.8)'
          context.shadowBlur = spark % 3 === 0 ? 2.5 : 1.5
          context.beginPath()
          context.arc(x, centerY + wave, radius, 0, Math.PI * 2)
          context.fill()
        }
        context.shadowBlur = 0
      }

      context.restore()
      context.globalAlpha = 1

      if (progress < 1) animationFrame = requestAnimationFrame(draw)
      else context.clearRect(0, 0, width, height)
    }

    animationFrame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animationFrame)
  }, [mode])

  const selectMode = (nextMode: WorkMode) => {
    if (nextMode !== mode) onModeChange(nextMode)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    selectMode(event.key === 'ArrowLeft' || event.key === 'Home' ? 'agent' : 'plan')
  }

  return (
    <div
      className={`relative h-9 w-[136px] overflow-hidden rounded-xl border border-border/25 bg-text-primary/[0.035] p-[3px] shadow-inner ${className}`}
      role="radiogroup"
      aria-label={language === 'zh' ? '工作模式' : 'Work mode'}
      onKeyDown={handleKeyDown}
    >
      <span
        aria-hidden="true"
        className={`absolute bottom-[3px] top-[3px] w-[63px] rounded-[9px] bg-gradient-to-b from-surface-active to-accent/[0.055] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_1px_0_rgba(255,255,255,0.035)_inset] transition-transform duration-[520ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${mode === 'plan' ? 'translate-x-[66px]' : 'translate-x-0'}`}
      />

      <div className="relative z-10 grid h-full grid-cols-2">
        {MODE_OPTIONS.map(option => {
          const selected = option.id === mode
          const description = option.id === 'agent'
            ? (language === 'zh' ? '直接执行任务' : 'Execute directly')
            : (language === 'zh' ? '先规划再执行' : 'Plan before execution')

          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              title={`${option.label} · ${description}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectMode(option.id)}
              className={`relative flex items-center justify-center rounded-[9px] text-[10px] font-medium tracking-[0.01em] transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 ${selected ? 'text-accent' : 'text-text-muted hover:text-text-secondary'}`}
            >
              {option.label}
            </button>
          )
        })}
      </div>

      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-20 h-full w-full text-accent"
      />
    </div>
  )
}
