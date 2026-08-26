import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { didChange } = vi.hoisted(() => ({
  didChange: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/renderer/services/electronAPI', () => ({
  api: {
    lsp: {
      didChange,
    },
  },
}))

vi.mock('@store', () => ({
  useStore: {
    getState: () => ({ workspace: null }),
  },
}))

describe('lspService editor change scheduling', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    didChange.mockClear()
    const { resetLspState } = await import('@/renderer/services/lspService')
    resetLspState()
  })

  afterEach(async () => {
    const { resetLspState } = await import('@/renderer/services/lspService')
    resetLspState()
    vi.useRealTimers()
  })

  it('coalesces rapid full-text changes and sends only the latest content', async () => {
    const { scheduleDidChangeDocument } = await import('@/renderer/services/lspService')

    scheduleDidChangeDocument('E:/workspace/app.ts', 'a')
    scheduleDidChangeDocument('E:/workspace/app.ts', 'ab')
    scheduleDidChangeDocument('E:/workspace/app.ts', 'abc')

    await vi.advanceTimersByTimeAsync(74)
    expect(didChange).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(didChange).toHaveBeenCalledTimes(1)
    expect(didChange).toHaveBeenCalledWith(expect.objectContaining({ text: 'abc', version: 1 }))
  })

  it('cancels a queued change when an immediate change supersedes it', async () => {
    const { didChangeDocument, scheduleDidChangeDocument } = await import('@/renderer/services/lspService')

    scheduleDidChangeDocument('E:/workspace/app.ts', 'queued')
    await didChangeDocument('E:/workspace/app.ts', 'immediate')
    await vi.runAllTimersAsync()

    expect(didChange).toHaveBeenCalledTimes(1)
    expect(didChange).toHaveBeenCalledWith(expect.objectContaining({ text: 'immediate' }))
  })
})
