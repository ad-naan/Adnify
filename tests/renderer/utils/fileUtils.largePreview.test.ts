import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  stat: vi.fn(),
  readTextChunk: vi.fn(),
  readFull: vi.fn(),
  openFile: vi.fn(),
  setActiveFile: vi.fn(),
}))

vi.mock('@/renderer/services/electronAPI', () => ({
  api: {
    file: {
      stat: mocks.stat,
      readTextChunk: mocks.readTextChunk,
      readFull: mocks.readFull,
    },
  },
}))

vi.mock('@store', () => ({
  useStore: {
    getState: () => ({ openFile: mocks.openFile, setActiveFile: mocks.setActiveFile }),
  },
}))

vi.mock('@components/common/ToastProvider', () => ({
  toast: { warning: vi.fn(), error: vi.fn() },
}))

vi.mock('@services/largeFileService', () => ({
  getFileInfo: vi.fn(),
  getLargeFileWarning: vi.fn(),
  isLargeFile: vi.fn(() => false),
}))

vi.mock('@services/fileFormatService', () => ({
  detectEolFromContent: vi.fn(() => 'LF'),
}))

vi.mock('@renderer/components/common/ConfirmDialog', () => ({
  globalConfirm: vi.fn(),
}))

describe('safeOpenFile very large file policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.stat.mockResolvedValue({ size: 200 * 1024 * 1024, isFile: true, isDirectory: false, mtimeMs: 0 })
    mocks.readTextChunk.mockResolvedValue({
      content: 'first page',
      startOffset: 0,
      nextOffset: 1024,
      totalSize: 200 * 1024 * 1024,
      eof: false,
    })
  })

  it('opens a bounded read-only page without loading the entire file', async () => {
    const { safeOpenFile } = await import('@renderer/utils/fileUtils')
    const result = await safeOpenFile('E:/workspace/huge.log', { showWarning: false })

    expect(result).toEqual({ success: true, isLargeFile: true })
    expect(mocks.readFull).not.toHaveBeenCalled()
    expect(mocks.readTextChunk).toHaveBeenCalledWith('E:/workspace/huge.log', 0, 2 * 1024 * 1024)
    expect(mocks.openFile).toHaveBeenCalledWith(
      'E:/workspace/huge.log',
      'first page',
      undefined,
      expect.objectContaining({
        kind: 'large-preview',
        largeFileView: expect.objectContaining({ totalSize: 200 * 1024 * 1024, chunkSize: 2 * 1024 * 1024 }),
      }),
    )
  })
})
