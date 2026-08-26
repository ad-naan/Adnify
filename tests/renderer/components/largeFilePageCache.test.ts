import { describe, expect, it } from 'vitest'
import { LargeFilePageCache } from '@renderer/components/editor/largeFilePageCache'
import type { TextFileChunk } from '@shared/types/fileChunk'

function page(startOffset: number): TextFileChunk {
  return {
    content: `page-${startOffset}`,
    startOffset,
    nextOffset: startOffset + 100,
    totalSize: 1_000,
    eof: false,
  }
}

describe('LargeFilePageCache', () => {
  it('evicts the least recently used decoded page at the hard capacity', () => {
    const cache = new LargeFilePageCache(2)
    cache.set(page(0))
    cache.set(page(100))

    expect(cache.get(0)?.content).toBe('page-0')
    cache.set(page(200))

    expect(cache.size).toBe(2)
    expect(cache.get(100)).toBeUndefined()
    expect(cache.get(0)?.content).toBe('page-0')
    expect(cache.get(200)?.content).toBe('page-200')
  })

  it('replaces an existing page without consuming another slot', () => {
    const cache = new LargeFilePageCache(2)
    cache.set(page(0))
    cache.set({ ...page(0), content: 'updated' })

    expect(cache.size).toBe(1)
    expect(cache.get(0)?.content).toBe('updated')
  })
})
