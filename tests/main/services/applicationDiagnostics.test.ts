import { beforeEach, describe, expect, it, vi } from 'vitest'
import { contentTracing, dialog, shell, type BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { ApplicationDiagnostics } from '@main/services/diagnostics/ApplicationDiagnostics'

vi.mock('electron', () => ({
  app: { getVersion: () => '1.7.66' },
  dialog: { showOpenDialog: vi.fn() },
  shell: { showItemInFolder: vi.fn() },
  contentTracing: { enableHeapProfiling: vi.fn(), startRecording: vi.fn(), stopRecording: vi.fn() },
}))
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(), mkdtemp: vi.fn(async (prefix: string) => `${prefix}unique`), writeFile: vi.fn(),
}))
vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn(async () => {}) }))
vi.mock('@main/services/diagnostics/ProcessDiagnostics', () => ({
  processDiagnostics: { sample: () => ({ sampledAt: 100, processes: [] }), getHistory: () => [{ sampledAt: 99, processes: [] }] },
}))

describe('on-demand application diagnostics', () => {
  const owner = { isDestroyed: () => false } as BrowserWindow
  let service: ApplicationDiagnostics
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ['E:/diagnostics-output'] })
    service = new ApplicationDiagnostics()
  })

  it('exports memory history without enabling tracing or heap profiling', async () => {
    const result = await service.capture(owner, { kind: 'memory' }, 'en')
    expect(result.success).toBe(true)
    const report = JSON.parse(String(vi.mocked(writeFile).mock.calls[0][1]))
    expect(report.recentSamples).toHaveLength(1)
    expect(report.recordingSamples).toEqual([])
    expect(report.heapProfilingIncluded).toBe(false)
    expect(contentTracing.startRecording).not.toHaveBeenCalled()
    expect(contentTracing.enableHeapProfiling).not.toHaveBeenCalled()
  })

  it('records ten process samples and enables optional profiling before tracing', async () => {
    const result = await service.capture(owner, { kind: 'trace', includeHeapProfiling: true }, 'zh')
    expect(result.success).toBe(true)
    expect(contentTracing.enableHeapProfiling).toHaveBeenCalledTimes(1)
    expect(vi.mocked(contentTracing.enableHeapProfiling).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(contentTracing.startRecording).mock.invocationCallOrder[0])
    expect(contentTracing.startRecording).toHaveBeenCalledWith(expect.objectContaining({
      trace_buffer_size_in_kb: 32768,
      included_categories: expect.arrayContaining(['disabled-by-default-memory-infra']),
    }))
    expect(delay).toHaveBeenCalledTimes(10)
    expect(contentTracing.stopRecording).toHaveBeenCalledTimes(1)
    const report = JSON.parse(String(vi.mocked(writeFile).mock.calls[0][1]))
    expect(report.recordingSamples).toHaveLength(10)
    expect(report.heapProfilingIncluded).toBe(true)
    await service.capture(owner, { kind: 'trace', includeHeapProfiling: true }, 'zh')
    expect(contentTracing.enableHeapProfiling).toHaveBeenCalledTimes(1)
  })

  it('reserves the recorder before the folder dialog and releases it on cancellation', async () => {
    let cancel!: (result: { canceled: boolean; filePaths: string[] }) => void
    vi.mocked(dialog.showOpenDialog).mockImplementationOnce(() => new Promise(resolve => { cancel = resolve }))
    const first = service.capture(owner, { kind: 'trace' }, 'en')
    await expect(service.capture(owner, { kind: 'trace' }, 'en')).resolves.toEqual({ success: false, code: 'BUSY' })
    cancel({ canceled: true, filePaths: [] })
    await expect(first).resolves.toEqual({ success: false, code: 'CANCELED' })
    expect(contentTracing.startRecording).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
    await expect(service.capture(owner, { kind: 'memory' }, 'en')).resolves.toMatchObject({ success: true })
  })

  it('finalizes an active trace when shutdown aborts the recording', async () => {
    let started!: () => void
    const waiting = new Promise<void>(resolve => { started = resolve })
    vi.mocked(delay).mockImplementationOnce((_ms, _value, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      started()
    }))
    const capture = service.capture(owner, { kind: 'trace' }, 'en')
    await waiting
    await service.stop()
    await expect(capture).resolves.toEqual({ success: false, code: 'CANCELED' })
    expect(contentTracing.stopRecording).toHaveBeenCalledTimes(1)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('reports an initialization failure and permits a later retry', async () => {
    vi.mocked(contentTracing.enableHeapProfiling).mockRejectedValueOnce(new Error('unavailable'))
    await expect(service.capture(owner, { kind: 'trace', includeHeapProfiling: true }, 'en'))
      .resolves.toEqual({ success: false, code: 'FAILED' })
    expect(contentTracing.startRecording).not.toHaveBeenCalled()
    await expect(service.capture(owner, { kind: 'trace' }, 'en')).resolves.toMatchObject({ success: true })
  })

  it('does not mark a saved report as failed if revealing the folder fails', async () => {
    vi.mocked(shell.showItemInFolder).mockImplementationOnce(() => { throw new Error('no file manager') })
    await expect(service.capture(owner, { kind: 'memory' }, 'en')).resolves.toMatchObject({ success: true })
  })
})
