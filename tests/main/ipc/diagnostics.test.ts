import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { registerDiagnosticsHandlers } from '@main/ipc/diagnostics'
import { applicationDiagnostics } from '@main/services/diagnostics/ApplicationDiagnostics'

vi.mock('electron', () => ({
  app: { isPackaged: true }, ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
}))
vi.mock('@main/services/diagnostics/ApplicationDiagnostics', () => ({
  applicationDiagnostics: { capture: vi.fn(async () => ({ success: true, directory: 'chosen-folder' })) },
}))

describe('diagnostics IPC boundary', () => {
  let invoke: (event: IpcMainInvokeEvent, options: unknown) => Promise<unknown>
  const sender = { id: 1, getURL: () => 'file:///app/index.html', mainFrame: {} }
  const owner = { webContents: sender }
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(owner as never)
    registerDiagnosticsHandlers({ preferencesStore: { get: () => 'zh' } })
    invoke = vi.mocked(ipcMain.handle).mock.calls[0][1]
  })

  it('accepts the application main frame and rejects renderer-selected output paths', async () => {
    const event = { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent
    await expect(invoke(event, { kind: 'memory' })).resolves.toMatchObject({ success: true })
    expect(applicationDiagnostics.capture).toHaveBeenCalledWith(owner, { kind: 'memory' }, 'zh')
    await expect(invoke(event, { kind: 'trace', outputPath: 'arbitrary-file' })).resolves.toMatchObject({ success: false })
    expect(applicationDiagnostics.capture).toHaveBeenCalledTimes(1)
  })

  it('blocks guest pages and subframes even if their URL passes the shared sender check', async () => {
    const guest = { ...sender, id: 2 }
    await expect(invoke({ sender: guest, senderFrame: guest.mainFrame } as unknown as IpcMainInvokeEvent, { kind: 'trace' }))
      .resolves.toMatchObject({ success: false })
    await expect(invoke({ sender, senderFrame: {} } as unknown as IpcMainInvokeEvent, { kind: 'trace' }))
      .resolves.toMatchObject({ success: false })
    expect(applicationDiagnostics.capture).not.toHaveBeenCalled()
  })
})
