import { describe, expect, it } from 'vitest'

import { useSmoothStream } from '@/renderer/hooks/useSmoothStream'

describe('useSmoothStream', () => {
  it('returns the complete latest chunk while streaming and after completion', () => {
    const content = 'complete streamed response'

    expect(useSmoothStream(content, true, 1.5)).toBe(content)
    expect(useSmoothStream(content, false, 1.5)).toBe(content)
  })
})
