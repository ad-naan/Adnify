import type { TextFileChunk } from '@shared/types/fileChunk'

/** Small LRU cache for decoded large-file windows. */
export class LargeFilePageCache {
  private pages = new Map<number, TextFileChunk>()

  constructor(private readonly capacity: number) {}

  get(offset: number): TextFileChunk | undefined {
    const page = this.pages.get(offset)
    if (!page) return undefined
    this.pages.delete(offset)
    this.pages.set(offset, page)
    return page
  }

  set(page: TextFileChunk): void {
    this.pages.delete(page.startOffset)
    this.pages.set(page.startOffset, page)
    while (this.pages.size > this.capacity) {
      const oldest = this.pages.keys().next().value
      if (oldest === undefined) return
      this.pages.delete(oldest)
    }
  }

  get size(): number {
    return this.pages.size
  }
}
