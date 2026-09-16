import { beforeEach, describe, expect, it, vi } from 'vitest'
import { activateChatFilePath, ChatFilePathBoundary } from '@renderer/components/agent/ChatFilePathBoundary'

const mocks = vi.hoisted(() => ({
  stat: vi.fn(), readDir: vi.fn(), openWithDefault: vi.fn(), showInFolder: vi.fn(), safeOpenFile: vi.fn(), error: vi.fn(), show: vi.fn(),
  state: { workspacePath: 'E:/Project/app', language: 'zh' },
}))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useCallback: (fn: unknown) => fn }))
vi.mock('@store', () => ({ useStore: Object.assign((select: (value: unknown) => unknown) => select(mocks.state), { getState: () => mocks.state }) }))
vi.mock('@renderer/services/electronAPI', () => ({ api: { file: mocks } }))
vi.mock('@renderer/utils/fileUtils', () => ({ isBinaryFile: (path: string) => path.endsWith('.zip'), safeOpenFile: mocks.safeOpenFile }))
vi.mock('@renderer/components/common/ToastProvider', () => ({ toast: { error: mocks.error } }))
vi.mock('@renderer/components/ui/ContextMenu', () => ({ ContextMenu: () => null, useContextMenu: () => ({ menu: null, show: mocks.show, hide: vi.fn() }) }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.stat.mockResolvedValue({ isDirectory: false })
  mocks.readDir.mockResolvedValue([])
  mocks.openWithDefault.mockResolvedValue(true)
  mocks.showInFolder.mockResolvedValue(true)
  mocks.safeOpenFile.mockResolvedValue({ success: true })
})

describe('chat file actions', () => {
  it('opens ZIP files via the OS without reading them as text', async () => {
    await activateChatFilePath('patches/a.zip')
    expect(mocks.openWithDefault).toHaveBeenCalledWith('E:/Project/app/patches/a.zip')
    expect(mocks.stat).toHaveBeenCalledWith('E:/Project/app/patches/a.zip')
    expect(mocks.safeOpenFile).not.toHaveBeenCalled()
  })
  it('retains safe text-file opening and opens directories in the OS', async () => {
    await activateChatFilePath('src/app.ts')
    expect(mocks.safeOpenFile).toHaveBeenCalledWith('E:/Project/app/src/app.ts', { language: 'zh' })
    mocks.stat.mockResolvedValue({ isDirectory: true })
    await activateChatFilePath('src/components/')
    expect(mocks.openWithDefault).toHaveBeenCalledWith('E:/Project/app/src/components')
  })
  it('finds a uniquely named nested file when the message only contains its basename', async () => {
    mocks.stat.mockResolvedValue(null)
    mocks.readDir.mockImplementation(async (path: string) => {
      if (path === 'E:/Project/app') return [{ name: 'packages', path: 'E:/Project/app/packages', isDirectory: true }]
      if (path === 'E:/Project/app/packages') return [{ name: 'browser-host', path: 'E:/Project/app/packages/browser-host', isDirectory: true }]
      if (path === 'E:/Project/app/packages/browser-host') return [{ name: 'src', path: 'E:/Project/app/packages/browser-host/src', isDirectory: true }]
      if (path === 'E:/Project/app/packages/browser-host/src') return [{ name: 'host.test.ts', path: 'E:/Project/app/packages/browser-host/src/host.test.ts', isDirectory: false }]
      return []
    })
    await activateChatFilePath('host.test.ts')
    expect(mocks.safeOpenFile).toHaveBeenCalledWith('E:/Project/app/packages/browser-host/src/host.test.ts', { language: 'zh' })
  })
  it('does not guess when multiple workspace files share the same basename', async () => {
    mocks.stat.mockResolvedValue(null)
    mocks.readDir.mockResolvedValue([
      { name: 'host.test.ts', path: 'E:/Project/app/a/host.test.ts', isDirectory: false },
      { name: 'host.test.ts', path: 'E:/Project/app/b/host.test.ts', isDirectory: false },
    ])
    await activateChatFilePath('host.test.ts')
    expect(mocks.safeOpenFile).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledOnce()
  })
  it('reveals the resolved file and reports missing paths or OS failures', async () => {
    await activateChatFilePath('patches/a.zip', true)
    expect(mocks.showInFolder).toHaveBeenCalledWith('E:/Project/app/patches/a.zip')
    mocks.showInFolder.mockResolvedValue(false)
    mocks.stat.mockImplementation(async (path: string) => path === 'E:/Project/app' ? { isDirectory: true } : null)
    await activateChatFilePath('missing.zip', true)
    expect(mocks.openWithDefault).toHaveBeenCalledWith('E:/Project/app')
    expect(mocks.error).not.toHaveBeenCalled()
    mocks.openWithDefault.mockRejectedValue(new Error('OS failure'))
    await activateChatFilePath('missing.zip')
    expect(mocks.error).toHaveBeenCalledOnce()
  })
  it('does no I/O at render or ordinary click; modifier click and context menu are delegated', async () => {
    const view = ChatFilePathBoundary({ children: 'body' })
    const element = { dataset: { chatFilePath: 'patches/a.zip' } }
    const closest = vi.fn((selector: string) => selector === 'a' ? null : element)
    const event = { button: 0, ctrlKey: false, metaKey: false, target: { closest }, currentTarget: { contains: () => true }, preventDefault: vi.fn(), stopPropagation: vi.fn() }
    expect(mocks.stat).not.toHaveBeenCalled()
    expect(mocks.openWithDefault).not.toHaveBeenCalled()
    view.props.onClick(event)
    expect(closest).not.toHaveBeenCalled()
    expect(mocks.openWithDefault).not.toHaveBeenCalled()
    view.props.onClick({ ...event, ctrlKey: true })
    await vi.waitFor(() => expect(mocks.openWithDefault).toHaveBeenCalledOnce())
    view.props.onContextMenu(event)
    expect(mocks.show).toHaveBeenCalledWith(event, 'patches/a.zip')
    expect(mocks.showInFolder).not.toHaveBeenCalled()
    view.props.onClick({ ...event, metaKey: true })
    await vi.waitFor(() => expect(mocks.openWithDefault).toHaveBeenCalledTimes(2))
    closest.mockImplementation(() => element)
    view.props.onClick({ ...event, ctrlKey: true })
    expect(mocks.openWithDefault).toHaveBeenCalledTimes(2)
  })
})
