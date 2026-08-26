import { afterEach, describe, expect, it, vi } from 'vitest'

describe('electronAPI file read intent', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('keeps bounded preview reads separate from full-buffer reads', async () => {
    const readFile = vi.fn().mockResolvedValue('content')
    vi.stubGlobal('window', { electronAPI: { readFile } })
    const { api } = await import('@/renderer/services/electronAPI')

    await api.file.readPreview('E:/workspace/large.txt', 'utf-8')
    await api.file.readFull('E:/workspace/large.txt', 'utf-8')

    expect(readFile).toHaveBeenNthCalledWith(1, 'E:/workspace/large.txt', 'utf-8')
    expect(readFile).toHaveBeenNthCalledWith(2, 'E:/workspace/large.txt', 'utf-8', { full: true })
    expect('read' in api.file).toBe(false)
  })
})
