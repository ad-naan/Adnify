import React, { useState, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'

// Simulation of EmotionAmbientGlow
function AmbientGlowLayer({ active }: { active: boolean }) {
  if (!active) return null

  const corners = [
    { top: 0, left: 0, origin: 'top left' },
    { top: 0, right: 0, origin: 'top right' },
    { bottom: 0, left: 0, origin: 'bottom left' },
    { bottom: 0, right: 0, origin: 'bottom right' },
  ]

  return (
    <div className="absolute inset-0 pointer-events-none z-[1] overflow-hidden">
      <div className="absolute inset-0">
        {corners.map((c, i) => (
          <div
            key={i}
            className="absolute ambient-light--animated"
            style={{
              width: 550,
              height: 550,
              ...c,
              background: `radial-gradient(circle at ${c.origin}, rgba(239, 68, 68, 0.25) 0%, transparent 280px)`,
              animationDuration: '4s',
            }}
          />
        ))}
      </div>
    </div>
  )
}

// Simulation of ReasoningParticleSlider active rAF Canvas Loop
function ParticleCanvasLayer({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!active) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = 400
    canvas.height = 36
    let frameId = 0
    let t = 0

    const particles = Array.from({ length: 26 }, () => ({
      x: Math.random() * 400,
      y: Math.random() * 36,
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2,
      size: 1.5,
    }))

    const loop = () => {
      t++
      ctx.clearRect(0, 0, 400, 36)
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = 'rgba(59, 130, 246, 0.8)'
      ctx.shadowColor = '#3b82f6'
      ctx.shadowBlur = 4

      for (const p of particles) {
        p.x = (p.x + p.vx + 400) % 400
        p.y = (p.y + p.vy + 36) % 36
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
      }

      frameId = requestAnimationFrame(loop)
    }

    frameId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frameId)
  }, [active])

  if (!active) return null
  return <canvas ref={canvasRef} className="border border-border/40 rounded my-2" />
}

export function GpuStressApp() {
  const [ambientActive, setAmbientActive] = useState(false)
  const [canvasActive, setCanvasActive] = useState(false)
  const [status, setStatus] = useState('initialized')

  useEffect(() => {
    // Expose control handles to window for test runner
    ;(window as any).__ADNIFY_GPU_TEST__ = {
      setAmbient: (v: boolean) => { setAmbientActive(v); setStatus(`ambient: ${v}`) },
      setCanvas: (v: boolean) => { setCanvasActive(v); setStatus(`canvas: ${v}`) },
    }
  }, [])

  return (
    <div className="relative w-screen h-screen bg-[#09090b] text-white p-8 overflow-hidden font-sans">
      <AmbientGlowLayer active={ambientActive} />
      <div className="relative z-10 max-w-xl">
        <h1 className="text-xl font-bold mb-4">Adnify GPU Stress Fixture</h1>
        <div className="p-4 bg-zinc-900/80 rounded-lg border border-zinc-800 space-y-3">
          <p className="text-sm text-zinc-400">Status: <span className="text-blue-400 font-mono">{status}</span></p>
          <div className="text-xs space-y-1 text-zinc-500 font-mono">
            <div>Ambient active: {String(ambientActive)}</div>
            <div>Canvas active: {String(canvasActive)}</div>
          </div>
          <ParticleCanvasLayer active={canvasActive} />
        </div>
      </div>
    </div>
  )
}

const root = createRoot(document.getElementById('root')!)
root.render(<GpuStressApp />)
