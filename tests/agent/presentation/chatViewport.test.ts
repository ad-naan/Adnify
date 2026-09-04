import { describe, expect, it } from 'vitest'
import { ChatViewport } from '@renderer/agent/presentation/chatViewport'

describe('chat viewport geometry', () => {
  it('pins the reading anchor throughout a collapse larger than the viewport', () => {
    const viewport = new ChatViewport()
    viewport.layout(3000, 800, 0)
    viewport.beginCollapse(2200, 508)
    for (let height = 2980; height >= 1000; height -= 20) {
      const geometry = viewport.layout(height, 800, 16)
      expect(geometry.scrollTop).toBe(2200)
      expect(height + geometry.tail).toBe(3000)
    }
  })

  it('consumes the held tail as new text grows before resuming bottom follow', () => {
    const viewport = new ChatViewport()
    viewport.layout(2000, 800, 0)
    viewport.layout(1600, 800, 16)
    expect(viewport.layout(1900, 800, 100)).toEqual({ scrollTop: 1200, tail: 100 })
    expect(viewport.layout(2100, 800, 600)).toEqual({ scrollTop: 1300, tail: 0 })
  })

  it('does not release the anchor when dock height changes during collapse', () => {
    const viewport = new ChatViewport()
    viewport.layout(2000, 800, 0)
    viewport.layout(1600, 800, 16)
    expect(viewport.layout(1600, 1000, 32)).toEqual({ scrollTop: 1200, tail: 600 })
    expect(viewport.layout(1600, 700, 48)).toEqual({ scrollTop: 1200, tail: 300 })
  })

  it('never scrolls a short initial conversation into artificial blank space', () => {
    const viewport = new ChatViewport()
    expect(viewport.layout(80, 700, 0)).toEqual({ scrollTop: 0, tail: 0 })
    expect(viewport.layout(160, 650, 16)).toEqual({ scrollTop: 0, tail: 0 })
    expect(viewport.layout(100, 700, 32)).toEqual({ scrollTop: 0, tail: 0 })
  })

  it('yields to user scroll and retires only invisible tail space', () => {
    const viewport = new ChatViewport()
    viewport.layout(2000, 800, 0)
    viewport.layout(1600, 800, 16)
    viewport.userScroll(1100, 220)
    expect(viewport.tail).toBe(300)
    expect(viewport.following).toBe(false)
    expect(viewport.layout(1800, 800, 32).scrollTop).toBe(1100)
    viewport.jumpToBottom()
    expect(viewport.tail).toBe(0)
    expect(viewport.scrollTop).toBe(1000)
  })

  it('preserves the clicked position instead of following a manual expansion', () => {
    const viewport = new ChatViewport()
    viewport.layout(1000, 800, 0)
    viewport.manualDisclosure(200, 508)
    expect(viewport.layout(1500, 800, 16).scrollTop).toBe(200)
    expect(viewport.following).toBe(false)
    expect(viewport.layout(1500, 800, 600).scrollTop).toBeUndefined()
  })
})
