/**
 * large-preview 是只读分页预览：store 里只有首个分页，且从不为它注册 Monaco model。
 * 任何把它接进写盘路径的改动都会用首页内容（或空串）覆盖整个文件 —— GB 级日志被
 * 截成 2MB 或 0 字节。这里把「只读文档不参与写盘」这条不变量固定住。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  writeDetailed: vi.fn(),
  getModel: vi.fn(),
  openFiles: [] as Array<Record<string, unknown>>,
  markFileSaved: vi.fn(),
  updateFileContent: vi.fn(),
  autoSave: 'off' as 'off' | 'afterDelay' | 'onFocusChange',
}))

vi.mock('@renderer/monacoWorker', () => ({
  monaco: {
    Uri: { file: (path: string) => path },
    editor: { getModel: mocks.getModel },
  },
}))

vi.mock('@renderer/services/electronAPI', () => ({
  api: { file: { write: mocks.write, writeDetailed: mocks.writeDetailed } },
}))

vi.mock('@store', () => ({
  useStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({
      markFileSaved: mocks.markFileSaved,
      closeFile: vi.fn(),
      language: 'en',
    }),
    {
      getState: () => ({
        openFiles: mocks.openFiles,
        markFileSaved: mocks.markFileSaved,
        updateFileContent: mocks.updateFileContent,
      }),
    },
  ),
}))

vi.mock('@renderer/settings', () => ({
  getEditorConfig: () => ({ autoSave: mocks.autoSave, autoSaveDelay: 1000, formatOnSave: false }),
}))

vi.mock('@renderer/components/common/ToastProvider', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@renderer/components/common/ConfirmDialog', () => ({ globalConfirm: vi.fn() }))

// 本仓库测试环境是 node、且未引入 testing-library。useFileSave 只用到
// useCallback/useRef/useEffect 这几个与渲染无关的 hook，直通即可当普通函数调用。
vi.mock('react', () => ({
  useCallback: <T,>(fn: T) => fn,
  useRef: <T,>(initial: T) => ({ current: initial }),
  useEffect: () => undefined,
}))

const LARGE_FILE = 'E:/workspace/huge.log'
/** 200MB 文件在 store 里只有首页；这就是错误写盘时会被当成「全文」的内容。 */
const FIRST_PAGE_ONLY = 'line 1\nline 2\n'

describe('isWritableDocumentKind', () => {
  it('rejects large-preview and accepts every editable kind', async () => {
    const { isWritableDocumentKind } = await import('@renderer/services/editorBufferService')

    expect(isWritableDocumentKind('large-preview')).toBe(false)
    expect(isWritableDocumentKind('file')).toBe(true)
    expect(isWritableDocumentKind('diff')).toBe(true)
    expect(isWritableDocumentKind('preview')).toBe(true)
    // 普通文件常常不带 kind，必须仍然可写，否则保存会整体失效
    expect(isWritableDocumentKind(undefined)).toBe(true)
  })
})

describe('save paths refuse to write a large-preview document', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mocks.autoSave = 'off'
    // large-preview 从不注册 model —— 这正是回退到首页内容的原因
    mocks.getModel.mockReturnValue(undefined)
    mocks.writeDetailed.mockResolvedValue({ success: true })
    mocks.write.mockResolvedValue(true)
    mocks.openFiles = [{
      path: LARGE_FILE,
      content: FIRST_PAGE_ONLY,
      kind: 'large-preview',
      isDirty: true,
      encoding: 'utf-8',
    }]
  })

  it('saveFile() does not truncate the file to its first page', async () => {
    const { useFileSave } = await import('@renderer/hooks/useFileSave')
    const { saveFile } = useFileSave()

    await expect(saveFile(LARGE_FILE)).resolves.toBe(false)
    expect(mocks.writeDetailed).not.toHaveBeenCalled()
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it('auto-save (afterDelay) skips it even while flagged dirty', async () => {
    mocks.autoSave = 'afterDelay'
    const { useFileSave } = await import('@renderer/hooks/useFileSave')
    const { triggerAutoSave } = useFileSave()

    triggerAutoSave(LARGE_FILE)
    await vi.advanceTimersByTimeAsync(2000)

    expect(mocks.write).not.toHaveBeenCalled()
  })

  it('still saves a normal dirty file through the same path', async () => {
    mocks.openFiles = [{
      path: 'E:/workspace/app.ts',
      content: 'const a = 1',
      kind: 'file',
      isDirty: true,
      encoding: 'utf-8',
    }]
    mocks.getModel.mockReturnValue({
      getValue: () => 'const a = 2',
      getAlternativeVersionId: () => 3,
    })

    const { useFileSave } = await import('@renderer/hooks/useFileSave')
    const { saveFile } = useFileSave()

    await expect(saveFile('E:/workspace/app.ts')).resolves.toBe(true)
    expect(mocks.writeDetailed).toHaveBeenCalledWith('E:/workspace/app.ts', 'const a = 2', 'utf-8')
  })
})
