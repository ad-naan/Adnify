import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { registerNotificationHandlers, cleanupNotificationHandlers } from '@main/ipc/notifications'

const runtime = vi.hoisted(() => ({
  initialize: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  settings: vi.fn(),
  saveSettings: vi.fn(),
  history: vi.fn(() => ({ revision: 0, records: [] })),
  visible: vi.fn(),
  activate: vi.fn(),
  service: { publish: vi.fn(), markRead: vi.fn(), clear: vi.fn(), test: vi.fn() },
}))
vi.mock('electron', () => ({
  app: { isPackaged: true },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
}))
vi.mock('@main/services/notifications/runtime', () => ({
  NotificationRuntime: class {
    constructor() {
      return runtime
    }
  },
}))

describe('notification IPC boundary', () => {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, raw?: unknown) => unknown>()
  const sender = { id: 10, getURL: () => 'file:///app/index.html', mainFrame: {} },
    owner = { id: 3, webContents: sender }
  const event = { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent
  const input = { type: 'test.completed', title: 'Done', message: '', level: 'success', attention: true }
  beforeEach(async () => {
    await cleanupNotificationHandlers()
    vi.clearAllMocks()
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(owner as never)
    registerNotificationHandlers({ getWindowWorkspace: () => ['workspace'] })
    vi.mocked(ipcMain.handle).mock.calls.forEach(([channel, handler]) => handlers.set(channel, handler))
  })
  it('derives context from the calling window and rejects spoofed or oversized inputs', async () => {
    await handlers.get('notifications:publish')!(event, [input])
    expect(runtime.service.publish).toHaveBeenCalledWith(input, { windowId: 3, workspace: 'workspace' })
    for (const raw of [[{ ...input, windowId: 99 }], [{ ...input, workspace: 'other' }], Array(41).fill(input)]) {
      expect(await handlers.get('notifications:publish')!(event, raw)).toMatchObject({ success: false })
    }
    expect(runtime.service.publish).toHaveBeenCalledTimes(1)
  })
  it('rejects remote pages, embedded guests and subframes on every channel', async () => {
    for (const handler of handlers.values()) {
      expect(await handler({ sender, senderFrame: {} } as IpcMainInvokeEvent, [])).toMatchObject({ success: false })
      const guest = { ...sender, id: 11 }
      expect(
        await handler({ sender: guest, senderFrame: guest.mainFrame } as unknown as IpcMainInvokeEvent, []),
      ).toMatchObject({ success: false })
      const remote = { ...sender, getURL: () => 'https://example.com' }
      expect(
        await handler({ sender: remote, senderFrame: remote.mainFrame } as unknown as IpcMainInvokeEvent, []),
      ).toMatchObject({ success: false })
    }
    expect(runtime.saveSettings).not.toHaveBeenCalled()
    expect(runtime.service.test).not.toHaveBeenCalled()
  })
  it('bounds event traffic and ignores activation outside the visible history', async () => {
    for (let i = 0; i < 3; i++) await handlers.get('notifications:publish')!(event, Array(40).fill(input))
    expect(await handlers.get('notifications:publish')!(event, [input])).toMatchObject({ success: false })
    expect(runtime.service.publish).toHaveBeenCalledTimes(120)
    await handlers.get('notifications:activate')!(event, 'hidden-record')
    expect(runtime.activate).not.toHaveBeenCalled()
  })
})
