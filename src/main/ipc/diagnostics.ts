import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { asLanguage } from '@shared/i18n'
import { applicationDiagnostics } from '../services/diagnostics/ApplicationDiagnostics'
import { safeIpcHandle } from './safeHandle'

const captureOptions = z.object({
  kind: z.enum(['memory', 'trace']),
  includeHeapProfiling: z.boolean().optional(),
}).strict()

export function registerDiagnosticsHandlers(context: { preferencesStore: { get(key: 'language'): unknown } }): void {
  safeIpcHandle('diagnostics:capture', (event, raw: unknown) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    // Local preview pages are not allowed to open diagnostic dialogs or record
    // other windows, even when their URL happens to be a trusted localhost URL.
    if (!owner || owner.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('Diagnostics require the application main frame')
    }
    const language = context.preferencesStore.get('language')
    return applicationDiagnostics.capture(owner, captureOptions.parse(raw),
      asLanguage(typeof language === 'string' ? language : undefined))
  })
}
