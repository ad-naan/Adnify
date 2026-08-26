import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updateFileContent: vi.fn(),
  reloadFileFromDisk: vi.fn(),
  markFileSaved: vi.fn(),
  model: {
    value: 'initial',
    getValue: vi.fn(),
    setValue: vi.fn(),
    getAlternativeVersionId: vi.fn(() => 7),
  },
}))

vi.mock('@renderer/monacoWorker', () => ({
  monaco: {
    Uri: { file: (path: string) => path },
    editor: { getModel: vi.fn(() => mocks.model) },
  },
}))

vi.mock('@store', () => ({
  useStore: {
    getState: () => ({
      updateFileContent: mocks.updateFileContent,
      reloadFileFromDisk: mocks.reloadFileFromDisk,
      markFileSaved: mocks.markFileSaved,
    }),
  },
}))

describe('editorBufferService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.model.value = 'initial'
    mocks.model.getValue.mockImplementation(() => mocks.model.value)
    mocks.model.setValue.mockImplementation((value: string) => { mocks.model.value = value })
  })

  afterEach(async () => {
    const { flushEditorBufferSnapshots } = await import('@renderer/services/editorBufferService')
    flushEditorBufferSnapshots()
    vi.useRealTimers()
  })

  it('coalesces high-frequency model snapshots into one store update', async () => {
    const { scheduleEditorBufferSnapshot } = await import('@renderer/services/editorBufferService')
    scheduleEditorBufferSnapshot('E:/app.ts', 'a')
    scheduleEditorBufferSnapshot('E:/app.ts', 'ab')
    scheduleEditorBufferSnapshot('E:/app.ts', 'abc')

    await vi.advanceTimersByTimeAsync(99)
    expect(mocks.updateFileContent).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(mocks.updateFileContent).toHaveBeenCalledTimes(1)
    expect(mocks.updateFileContent).toHaveBeenCalledWith('E:/app.ts', 'abc')
  })

  it('reads the live Monaco buffer instead of a delayed store snapshot', async () => {
    const { getEditorBufferContent } = await import('@renderer/services/editorBufferService')
    mocks.model.value = 'live content'
    expect(getEditorBufferContent('E:/app.ts', 'stale snapshot')).toBe('live content')
  })

  it('applies disk content to the store and model as one saved transition', async () => {
    const { applySavedEditorBufferContent } = await import('@renderer/services/editorBufferService')
    applySavedEditorBufferContent('E:/app.ts', 'from disk')

    expect(mocks.reloadFileFromDisk).toHaveBeenCalledWith('E:/app.ts', 'from disk')
    expect(mocks.model.setValue).toHaveBeenCalledWith('from disk')
    expect(mocks.markFileSaved).toHaveBeenCalledWith('E:/app.ts', 7)
  })
})
