import { describe, it, expect } from 'vitest'
import { domScript, elementActionScript, cursorOverlayScript } from '../../src/shared/preview/browserScripts'
import { browserActionSchema, browserInspectSchema } from '../../src/shared/preview/browserAutomation'

describe('Browser Automation & jev-ultrafast Indexed Action Space', () => {
  it('validates browserActionSchema with element ID as integer or @string', () => {
    // 1. Accepts element as number
    const r1 = browserActionSchema.safeParse({ action: 'click', element: 1 })
    expect(r1.success).toBe(true)

    // 2. Accepts element as string "@1"
    const r2 = browserActionSchema.safeParse({ action: 'click', element: '@1' })
    expect(r2.success).toBe(true)

    // 3. Accepts fill with element and text
    const r3 = browserActionSchema.safeParse({ action: 'fill', element: 2, text: 'hello' })
    expect(r3.success).toBe(true)

    // 4. Accepts classic CSS selector
    const r4 = browserActionSchema.safeParse({ action: 'click', selector: '#btn-submit' })
    expect(r4.success).toBe(true)

    // 5. Rejects click when neither element nor selector is provided
    const r5 = browserActionSchema.safeParse({ action: 'click' })
    expect(r5.success).toBe(false)
  })

  it('generates valid domScript and cursorOverlayScript code', () => {
    const script = domScript(undefined, 80)
    expect(script).toContain('__adnifyFast')
    expect(script).toContain('indexedTable')
    expect(script).toContain('data-adnify-id')

    const overlay = cursorOverlayScript()
    expect(overlay).toContain('adnify-agent-cursor')
    expect(overlay).toContain('adnify-agent-overlay')
    expect(overlay).toContain('__adnifyUpdateCursor')
    expect(overlay).toContain('__adnifyClickRipple')
  })

  it('generates elementActionScript supporting @elementId and regular selectors', () => {
    const clickScript = elementActionScript('click', '@1')
    expect(clickScript).toContain('data-adnify-id')
    expect(clickScript).toContain('"click"')

    const fillScript = elementActionScript('fill', '@2', 'test text')
    expect(fillScript).toContain('"fill"')
    expect(fillScript).toContain('test text')

    const scrollScript = elementActionScript('scroll', undefined, undefined, 0, 500)
    expect(scrollScript).toContain('"scroll"')
    expect(scrollScript).toContain('500')
  })

  it('calculates realistic cubic Bézier mouse trajectory curves', () => {
    const startX = 100
    const startY = 100
    const targetX = 500
    const targetY = 400

    const dx = targetX - startX
    const dy = targetY - startY
    const dist = Math.hypot(dx, dy)
    expect(dist).toBeGreaterThan(0)

    const steps = Math.max(10, Math.min(24, Math.round(dist / 30)))
    const deviation = Math.min(50, dist * 0.15)
    const perpX = -dy / dist
    const perpY = dx / dist

    const cp1X = startX + dx * 0.25 + perpX * deviation
    const cp1Y = startY + dy * 0.25 + perpY * deviation
    const cp2X = startX + dx * 0.75 + perpX * (deviation * 0.5)
    const cp2Y = startY + dy * 0.75 + perpY * (deviation * 0.5)

    const points: Array<{ x: number; y: number }> = []
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const p = 1 - Math.pow(1 - t, 3)
      const u = 1 - p
      const cx = Math.round(u * u * u * startX + 3 * u * u * p * cp1X + 3 * u * p * p * cp2X + p * p * p * targetX)
      const cy = Math.round(u * u * u * startY + 3 * u * u * p * cp1Y + 3 * u * p * p * cp2Y + p * p * p * targetY)
      points.push({ x: cx, y: cy })
    }

    expect(points.length).toBe(steps)
    // First point should be close to start
    expect(Math.hypot(points[0].x - startX, points[0].y - startY)).toBeLessThan(dist * 0.5)
    // Final point must exactly reach target
    expect(points[points.length - 1].x).toBe(targetX)
    expect(points[points.length - 1].y).toBe(targetY)
  })

  it('calculates decaying momentum fractions for wheel scroll', () => {
    const fractions = [0.30, 0.25, 0.18, 0.12, 0.08, 0.04, 0.02, 0.01]
    const sum = fractions.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1.0, 2)

    const totalDelta = 600
    const steps = fractions.map(f => Math.round(totalDelta * f))
    // Each step should be monotonically decreasing (momentum decay)
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeLessThanOrEqual(steps[i - 1])
    }
  })
})
