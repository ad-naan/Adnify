import { app, contentTracing, dialog, shell, type BrowserWindow } from 'electron'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { t, type Language } from '@shared/i18n'
import type { DiagnosticsCaptureOptions, DiagnosticsCaptureResult } from '@shared/types/diagnostics'
import { logger } from '@shared/utils/Logger'
import { processDiagnostics } from './ProcessDiagnostics'

/** One recorder for the whole app: Chromium tracing is shared by all windows. */
export class ApplicationDiagnostics {
  private busy = false
  private abort?: AbortController
  private pending?: Promise<DiagnosticsCaptureResult>
  private heapProfilingEnabled = false

  capture(owner: BrowserWindow, options: DiagnosticsCaptureOptions, language: Language): Promise<DiagnosticsCaptureResult> {
    if (this.busy) return Promise.resolve({ success: false, code: 'BUSY' })
    this.busy = true
    const controller = new AbortController()
    this.abort = controller
    this.pending = this.run(owner, options, language, controller.signal).finally(() => {
      this.busy = false
      this.abort = undefined
      this.pending = undefined
    })
    return this.pending
  }

  async stop(): Promise<void> {
    this.abort?.abort()
    await this.pending
  }

  private async run(owner: BrowserWindow, options: DiagnosticsCaptureOptions, language: Language, signal: AbortSignal): Promise<DiagnosticsCaptureResult> {
    let traceStarted = false
    let tracePath: string | undefined
    try {
      const selection = await dialog.showOpenDialog(owner, {
        title: t('systemSettings.diagnosticsChooseFolder', language),
        properties: ['openDirectory', 'createDirectory'],
      })
      if (selection.canceled || !selection.filePaths[0] || signal.aborted || owner.isDestroyed()) {
        return { success: false, code: 'CANCELED' }
      }
      const root = selection.filePaths[0]
      await mkdir(root, { recursive: true })
      const directory = await mkdtemp(join(root, `adnify-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}-`))
      const startedAt = Date.now()
      processDiagnostics.sample()
      const recentSamples = processDiagnostics.getHistory()
      const recordingSamples = []
      if (options.kind === 'trace') {
        tracePath = join(directory, 'trace.json')
        if (options.includeHeapProfiling && !this.heapProfilingEnabled) {
          await contentTracing.enableHeapProfiling({ mode: 'all', samplingRate: 100_000 })
          this.heapProfilingEnabled = true
        }
        signal.throwIfAborted()
        await contentTracing.startRecording({
          recording_mode: 'record-until-full',
          trace_buffer_size_in_kb: 32 * 1024,
          included_categories: [
            'electron', 'toplevel', 'blink', 'cc', 'gpu', 'v8',
            'disabled-by-default-devtools.timeline',
            ...(options.includeHeapProfiling ? ['disabled-by-default-memory-infra'] : []),
          ],
          excluded_categories: ['*'],
          ...(options.includeHeapProfiling ? {
            memory_dump_config: { triggers: [{ mode: 'detailed', periodic_interval_ms: 2000 }] },
          } : {}),
        })
        traceStarted = true
        for (let second = 0; second < 10; second++) {
          await delay(1000, undefined, { signal })
          recordingSamples.push(processDiagnostics.sample())
        }
        await contentTracing.stopRecording(tracePath)
        traceStarted = false
      }
      signal.throwIfAborted()
      await writeFile(join(directory, 'process-memory.json'), JSON.stringify({
        schemaVersion: 1,
        appVersion: app.getVersion(),
        versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
        platform: process.platform,
        arch: process.arch,
        startedAt,
        finishedAt: Date.now(),
        kind: options.kind,
        heapProfilingIncluded: options.kind === 'trace' && !!options.includeHeapProfiling,
        recentSamples,
        recordingSamples,
      }, null, 2), { encoding: 'utf8', mode: 0o600 })
      // Revealing the result is optional; a shell failure must not turn a saved
      // capture into a failed operation.
      try { if (!owner.isDestroyed()) shell.showItemInFolder(join(directory, 'process-memory.json')) } catch { /* Saved successfully. */ }
      return { success: true, directory }
    } catch (error) {
      if (signal.aborted) return { success: false, code: 'CANCELED' }
      logger.system.error('[Diagnostics] Capture failed', error)
      return { success: false, code: 'FAILED' }
    } finally {
      if (traceStarted) {
        try { await contentTracing.stopRecording(tracePath) } catch (error) {
          logger.system.warn('[Diagnostics] Could not finalize interrupted trace', error)
        }
      }
    }
  }
}

export const applicationDiagnostics = new ApplicationDiagnostics()
