import { describe, expect, it } from 'vitest'
import { ChatViewport } from '@renderer/agent/presentation/chatViewport'

describe('chat viewport follows real bounds', () => {
  it('keeps the reply at the bottom throughout a multi-viewport collapse', () => {
    const viewport = new ChatViewport()
    viewport.layout(3000, 800)
    for (let height = 2980; height >= 1000; height -= 20) {
      const { scrollTop } = viewport.layout(height, 800)
      expect(height - scrollTop!).toBe(800)
    }
    expect(viewport.layout(1000, 800)).toEqual({ scrollTop: 200 })
  })

  it('handles simultaneous process and dock collapse without a delayed correction', () => {
    const viewport = new ChatViewport()
    viewport.layout(2000, 800)
    expect(viewport.layout(1600, 1000)).toEqual({ scrollTop: 600 })
    expect(viewport.layout(1200, 1100)).toEqual({ scrollTop: 100 })
    expect(viewport.layout(1200, 1100)).toEqual({ scrollTop: 100 })
  })

  it('does not scroll short conversations past the first message', () => {
    const viewport = new ChatViewport()
    for (const height of [80, 160, 100]) expect(viewport.layout(height, 700)).toEqual({ scrollTop: 0 })
  })

  it('preserves the clicked position during manual expansion', () => {
    const viewport = new ChatViewport()
    viewport.layout(1000, 800)
    viewport.manualDisclosure(200)
    expect(viewport.layout(1500, 800).scrollTop).toBeUndefined()
    expect(viewport.scrollTop).toBe(200)
    expect(viewport.following).toBe(false)
  })

  it('clamps a manual collapse to real bounds without scheduling a second movement', () => {
    const viewport = new ChatViewport()
    viewport.layout(2000, 800)
    viewport.manualDisclosure(1200)
    expect(viewport.layout(900, 800)).toEqual({ scrollTop: 100 })
    expect(viewport.layout(900, 800)).toEqual({ scrollTop: undefined })
    expect(viewport.following).toBe(false)
  })

  it('does not drag a user reading history down when new content arrives', () => {
    const viewport = new ChatViewport()
    viewport.layout(2000, 800)
    viewport.userScroll(600, 220)
    expect(viewport.layout(2300, 800).scrollTop).toBeUndefined()
    expect(viewport.scrollTop).toBe(600)
    viewport.jumpToBottom()
    expect(viewport.scrollTop).toBe(1500)
    expect(viewport.following).toBe(true)
  })

  it('resumes following when the user scrolls back to the bottom', () => {
    const viewport = new ChatViewport()
    viewport.layout(2000, 800)
    viewport.userScroll(600, 220)
    viewport.userScroll(1200, 220)
    expect(viewport.layout(2100, 800)).toEqual({ scrollTop: 1300 })
  })
})
