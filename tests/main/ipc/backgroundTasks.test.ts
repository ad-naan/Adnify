import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { registerBackgroundTaskHandlers } from '@main/ipc/backgroundTasks'
import { backgroundTaskService } from '@main/services/backgroundTasks/BackgroundTaskService'

vi.mock('electron', () => ({
  app: { isPackaged: true }, ipcMain: { handle: vi.fn() }, BrowserWindow: { fromWebContents: vi.fn() },
}))
vi.mock('@main/services/backgroundTasks/BackgroundTaskService', () => ({ backgroundTaskService: {
  start: vi.fn(), refresh: vi.fn(), update: vi.fn(), getConnections: vi.fn(), check: vi.fn(),
} }))
vi.mock('@main/services/backgroundTasks/checkConnections', () => ({ checkConnections: vi.fn() }))

describe('background tasks IPC boundary', () => {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, raw?: unknown) => unknown>()
  const sender = { id: 1, getURL: () => 'file:///app/index.html', mainFrame: {} }
  const owner = { webContents: sender }
  const event = { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(owner as never)
    registerBackgroundTaskHandlers({ get: () => undefined, onDidChange: () => () => {} })
    vi.mocked(ipcMain.handle).mock.calls.forEach(([channel, handler]) => handlers.set(channel, handler))
  })
  it('uses the calling window and accepts only bounded activity data', async () => {
    expect(await handlers.get('backgroundTasks:update')!(event, { state: 'running', progress: 0.2 })).toBe(true)
    expect(backgroundTaskService.update).toHaveBeenCalledWith(owner, { state: 'running', progress: 0.2 })
    for (const raw of [
      { state: 'running', progress: Infinity }, { state: 'running', progress: -1 },
      { state: 'running', windowId: 99 }, { state: 'running', preventIdleSleep: true },
      { state: 'running', model: { provider: 'custom', apiKey: 'secret' } },
    ]) expect(await handlers.get('backgroundTasks:update')!(event, raw)).toMatchObject({ success: false })
    expect(backgroundTaskService.update).toHaveBeenCalledTimes(1)
  })
  it('rejects guests and subframes on every channel', async () => {
    for (const handler of handlers.values()) {
      const guest = { ...sender, id: 2 }
      expect(await handler({ sender: guest, senderFrame: guest.mainFrame } as unknown as IpcMainInvokeEvent, { state: 'running' }))
        .toMatchObject({ success: false })
      expect(await handler({ sender, senderFrame: {} } as unknown as IpcMainInvokeEvent, { state: 'running' }))
        .toMatchObject({ success: false })
    }
    expect(backgroundTaskService.update).not.toHaveBeenCalled()
    expect(backgroundTaskService.check).not.toHaveBeenCalled()
  })
})
