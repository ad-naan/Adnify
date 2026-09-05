import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { registerPreviewHandlers } from '@main/ipc/preview'
import { previewPartitionService } from '@main/services/previewPartitionService'
import { previewBrowserService } from '@main/services/previewBrowserService'

vi.mock('electron', () => ({ app: { isPackaged: true }, shell: {}, BrowserWindow: { fromWebContents: vi.fn() }, ipcMain: { handle: vi.fn() } }))
vi.mock('@main/services/previewPartitionService', () => ({ previewPartitionService: { prepare: vi.fn(() => ({ partition: 'project', scope: 'workspace' })) } }))
vi.mock('@main/services/previewBrowserService', () => ({ previewBrowserService: { configureDevice: vi.fn(async () => {}) } }))

describe('preview configuration IPC', () => {
  const sender = { id: 17, mainFrame: {}, getURL: () => 'file:///app/index.html' }
  const event = { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent
  const roots = vi.fn(() => ['/project'])
  const invoke = (channel: string, input: unknown, source = event) => vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1](source, input)
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue({ id: 3, webContents: sender } as never)
    registerPreviewHandlers(roots)
  })
  it('uses the sender WebContents identity for the existing workspace registry', async () => {
    await expect(invoke('preview:prepareSession', { workspaceRoot: '/project' })).resolves.toMatchObject({ success: true })
    expect(roots).toHaveBeenCalledWith(17)
    expect(previewPartitionService.prepare).toHaveBeenCalledWith(sender, ['/project'], '/project')
  })
  it('rejects arbitrary partitions, guests and subframes before changing sessions or devices', async () => {
    await expect(invoke('preview:prepareSession', { partition: 'persist:adnify-preview' })).resolves.toMatchObject({ success: false })
    await expect(invoke('preview:prepareSession', {}, { sender, senderFrame: {} } as unknown as IpcMainInvokeEvent)).resolves.toMatchObject({ success: false })
    await expect(invoke('preview:configureDevice', {}, { sender: { ...sender, id: 18 }, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent)).resolves.toMatchObject({ success: false })
    expect(previewPartitionService.prepare).not.toHaveBeenCalled()
    expect(previewBrowserService.configureDevice).not.toHaveBeenCalled()
  })
})
