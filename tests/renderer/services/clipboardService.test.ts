import { beforeEach, describe, expect, it, vi } from 'vitest'

const writeText = vi.fn()

vi.mock('@/renderer/services/electronAPI', () => ({
  api: {
    clipboard: {
      writeText,
      readText: vi.fn(),
    },
  },
}))

describe('clipboardService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the preload clipboard bridge before the browser permission API', async () => {
    writeText.mockResolvedValue(true)
    const browserWriteText = vi.fn()
    vi.stubGlobal('navigator', { clipboard: { writeText: browserWriteText } })

    const { writeClipboardText } = await import('@/renderer/services/clipboardService')
    await expect(writeClipboardText('copied text')).resolves.toBe(true)

    expect(writeText).toHaveBeenCalledWith('copied text')
    expect(browserWriteText).not.toHaveBeenCalled()
  })
})
