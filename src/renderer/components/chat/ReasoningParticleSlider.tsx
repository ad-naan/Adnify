import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/renderer/utils/cn'
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

const PANEL_SIZE = 180
const VIEWPORT_MARGIN = 12

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
  const activeOption = options[selectedIndex] || options[0]
  const currentValue = activeOption?.value ?? 'medium'
  const isThinkingActive = enabled && currentValue !== 'none'
  const count = options.length

  // Ergonomic dial arc: -135deg (bottom-left) to +135deg (bottom-right)
  const sweepAngle = 270
  const startAngle = -135
  const currentAngle = count > 1
    ? startAngle + (selectedIndex / (count - 1)) * sweepAngle
    : 0

  const updatePosition = useCallback(() => {
    const button = buttonRef.current
    if (!button) return
    const rect = button.getBoundingClientRect()
    const left = Math.min(
      window.innerWidth - PANEL_SIZE - VIEWPORT_MARGIN,
      Math.max(VIEWPORT_MARGIN, rect.right - PANEL_SIZE),
    )
    setPanelStyle({
      position: 'fixed',
      left,
      bottom: window.innerHeight - rect.top + 8,
      width: PANEL_SIZE,
      height: PANEL_SIZE,
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
      if (!buttonRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [isOpen])

  const handleSelectIndex = useCallback((idx: number) => {
    const opt = options[idx]
    if (opt) {
      onChange(opt.value)
      onCommit()
    }
  }, [options, onChange, onCommit])

  const handleRotateNext = useCallback(() => {
    const nextIdx = (selectedIndex + 1) % count
    handleSelectIndex(nextIdx)
  }, [selectedIndex, count, handleSelectIndex])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    if (e.deltaY > 0) {
      const nextIdx = Math.min(count - 1, selectedIndex + 1)
      handleSelectIndex(nextIdx)
    } else {
      const prevIdx = Math.max(0, selectedIndex - 1)
      handleSelectIndex(prevIdx)
    }
  }, [count, selectedIndex, handleSelectIndex])

  const handleMiniWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.deltaY > 0) {
      const nextIdx = Math.min(count - 1, selectedIndex + 1)
      handleSelectIndex(nextIdx)
    } else {
      const prevIdx = Math.max(0, selectedIndex - 1)
      handleSelectIndex(prevIdx)
    }
  }, [count, selectedIndex, handleSelectIndex])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault()
      handleSelectIndex(Math.max(0, selectedIndex - 1))
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      handleSelectIndex(Math.min(count - 1, selectedIndex + 1))
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }, [selectedIndex, count, handleSelectIndex])

  // Geometry for 180x180 Popover
  const cx = 90
  const cy = 90
  const radius = 44

  const panel = isOpen && panelStyle
    ? createPortal(
      <div
        ref={panelRef}
        style={panelStyle}
        onKeyDown={handleKeyDown}
        onWheel={handleWheel}
        tabIndex={-1}
        className="floating-surface rounded-2xl border border-border/60 bg-background/95 backdrop-blur-2xl p-1 shadow-2xl shadow-black/40 animate-scale-in select-none relative flex items-center justify-center focus:outline-none overflow-hidden"
      >
        {/* SVG Radial Ticks & Clickable Labels */}
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 180 180">
          {options.map((opt, i) => {
            const deg = count > 1 ? startAngle + (i / (count - 1)) * sweepAngle : 0
            const rad = (deg - 90) * (Math.PI / 180)
            const x1 = cx + (radius + 1) * Math.cos(rad)
            const y1 = cy + (radius + 1) * Math.sin(rad)
            const x2 = cx + (radius + 7) * Math.cos(rad)
            const y2 = cy + (radius + 7) * Math.sin(rad)
            const tx = cx + (radius + 20) * Math.cos(rad)
            const ty = cy + (radius + 20) * Math.sin(rad) + 3.5
            const isSelected = i === selectedIndex

            return (
              <g key={opt.value} className="cursor-pointer" onClick={() => handleSelectIndex(i)}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={isSelected ? 'rgb(var(--accent))' : 'currentColor'}
                  className={isSelected ? '' : 'text-border-active/60'}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  strokeLinecap="round"
                />
                <text
                  x={tx}
                  y={ty}
                  textAnchor="middle"
                  fontSize={isSelected ? 11 : 9.5}
                  fontWeight={isSelected ? 'bold' : '500'}
                  fill={isSelected ? 'rgb(var(--accent))' : 'currentColor'}
                  className={isSelected ? '' : 'text-text-secondary hover:text-text-primary transition-colors'}
                >
                  {opt.label}
                </text>
              </g>
            )
          })}
        </svg>

        {/* The Physical Milled Rotary Knob in Popover */}
        <div
          onClick={handleRotateNext}
          style={{
            transform: `rotate(${currentAngle}deg)`,
            transition: 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
          className="adnify-dial-knob w-[72px] h-[72px] rounded-full border border-border/80 flex items-center justify-center relative cursor-pointer shadow-xl select-none group active:scale-95"
          title={language === 'zh' ? '点击或滚动滚轮步进' : 'Click or scroll to adjust'}
        >
          {/* Knurled ridge ring */}
          <div className="absolute inset-1 rounded-full border adnify-knob-rim pointer-events-none" />

          {/* Electric Accent Laser Notch - Perfectly centered horizontally at top rim */}
          <div
            className={cn(
              "absolute top-1.5 inset-x-0 mx-auto w-1.5 h-3 rounded-full transition-colors pointer-events-none",
              isThinkingActive
                ? "bg-accent shadow-[0_0_8px_rgb(var(--accent)/0.8)]"
                : "bg-text-muted/70",
            )}
          />

          {/* Center Cap - Counter-rotated so text remains permanently upright */}
          <div
            style={{
              transform: `rotate(${-currentAngle}deg)`,
              transition: 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
            }}
            className="w-10 h-10 rounded-full bg-surface border border-border/80 flex flex-col items-center justify-center text-center shadow-inner pointer-events-none"
          >
            <span className="text-[7.5px] font-mono text-text-muted font-bold tracking-wider leading-none">
              TIER
            </span>
            <span className="text-[12px] font-bold text-accent mt-0.5 leading-none">
              {activeOption?.label}
            </span>
          </div>
        </div>
      </div>,
      document.body,
    )
    : null

  return (
    <>
      <style>{`
        /* Dark Mode: default + [data-theme='dark'] + .dark */
        .adnify-dial-knob,
        [data-theme='dark'] .adnify-dial-knob,
        .dark .adnify-dial-knob {
          background: conic-gradient(
            from 180deg at 50% 50%,
            #1e2533 0deg,
            #333e52 45deg,
            #171c26 90deg,
            #333e52 135deg,
            #1e2533 180deg,
            #333e52 225deg,
            #171c26 270deg,
            #333e52 315deg,
            #1e2533 360deg
          );
          box-shadow: 
            0 2px 6px -1px rgba(0, 0, 0, 0.6),
            inset 0 1px 1.5px rgba(255, 255, 255, 0.16),
            inset 0 -1.5px 3px rgba(0, 0, 0, 0.7),
            0 0 0 1px rgba(255, 255, 255, 0.08);
        }

        .adnify-knob-rim,
        [data-theme='dark'] .adnify-knob-rim,
        .dark .adnify-knob-rim {
          border-color: rgba(255, 255, 255, 0.12);
        }

        /* Light Mode: [data-theme='light'] + .light */
        [data-theme='light'] .adnify-dial-knob,
        .light .adnify-dial-knob {
          background: conic-gradient(
            from 180deg at 50% 50%,
            #e2e8f0 0deg,
            #ffffff 45deg,
            #cbd5e1 90deg,
            #ffffff 135deg,
            #e2e8f0 180deg,
            #ffffff 225deg,
            #cbd5e1 270deg,
            #ffffff 315deg,
            #e2e8f0 360deg
          );
          box-shadow: 
            0 2px 5px -1px rgba(0, 0, 0, 0.12),
            inset 0 1px 2px rgba(255, 255, 255, 0.95),
            inset 0 -1.5px 2px rgba(0, 0, 0, 0.12),
            0 0 0 1px rgba(0, 0, 0, 0.08);
        }

        [data-theme='light'] .adnify-knob-rim,
        .light .adnify-knob-rim {
          border-color: rgba(0, 0, 0, 0.08);
        }
      `}</style>

      {/* Input Toolbar Mini Rotary Dial Button (Frameless, Clean, Prominent) */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(open => !open)}
        onWheel={handleMiniWheel}
        title={t('reasoningParticleSlider.reasoningEffort2', language, { selectedLabel: activeOption?.label ?? '' })}
        aria-label={t('reasoningParticleSlider.selectReasoningEffort', language)}
        aria-expanded={isOpen}
        className="w-8 h-8 flex items-center justify-center cursor-pointer select-none group focus:outline-none bg-transparent border-0 p-0 transition-transform hover:scale-105 active:scale-95"
      >
        {/* Prominent Physical Rotary Knob (26px) - Rotates smoothly around its center */}
        <div
          style={{
            transform: `rotate(${currentAngle}deg)`,
            transition: 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
          className={cn(
            "adnify-dial-knob w-[26px] h-[26px] rounded-full border relative flex items-center justify-center select-none shadow-sm",
            isThinkingActive
              ? "border-accent/40 shadow-[0_1px_6px_rgb(var(--accent)/0.35)] opacity-100"
              : "border-border/80 opacity-70 group-hover:opacity-100",
            isOpen && "ring-2 ring-accent/40 border-accent",
          )}
        >
          {/* Inner knurling rim */}
          <div className="absolute inset-0.5 rounded-full border adnify-knob-rim pointer-events-none" />

          {/* Precision Laser Pointer Notch - Perfectly concentric at the top rim */}
          <div
            className={cn(
              "absolute top-[2px] inset-x-0 mx-auto w-[2.5px] h-[5px] rounded-full pointer-events-none",
              isThinkingActive
                ? "bg-accent shadow-[0_0_6px_rgb(var(--accent))]"
                : "bg-text-muted/70",
            )}
          />

          {/* Center Micro Cap (perfectly centered circle) */}
          <div className="w-2.5 h-2.5 rounded-full bg-surface border border-border/70 shadow-inner pointer-events-none" />
        </div>
      </button>

      {panel}
    </>
  )
})
