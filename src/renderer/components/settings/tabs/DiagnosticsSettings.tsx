import { useState } from 'react'
import { Activity, Download } from 'lucide-react'
import { api } from '@renderer/services/electronAPI'
import { Button, Switch } from '@components/ui'
import { toast } from '@components/common/ToastProvider'
import { t, type Language } from '@shared/i18n'
import type { DiagnosticsCaptureOptions } from '@shared/types/diagnostics'

export function DiagnosticsSettings({ language }: { language: Language }) {
  const [pending, setPending] = useState<DiagnosticsCaptureOptions['kind'] | null>(null)
  const [includeHeapProfiling, setIncludeHeapProfiling] = useState(false)

  const capture = async (kind: DiagnosticsCaptureOptions['kind']) => {
    if (pending) return
    setPending(kind)
    try {
      const result = await api.settings.captureDiagnostics({ kind, includeHeapProfiling: kind === 'trace' && includeHeapProfiling })
      if (result.success) {
        toast.success(t('systemSettings.diagnosticsSaved', language, { path: result.directory }))
      } else if (result.code !== 'CANCELED') {
        toast.error(t(result.code === 'BUSY' ? 'systemSettings.diagnosticsBusy' : 'systemSettings.diagnosticsFailed', language))
      }
    } catch {
      toast.error(t('systemSettings.diagnosticsFailed', language))
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="rounded-xl border border-border/70 bg-surface/25 p-5 space-y-4">
      <div>
        <div className="text-sm font-bold text-text-primary">{t('systemSettings.diagnosticsTitle', language)}</div>
        <p className="text-xs text-text-muted mt-1 leading-relaxed">{t('systemSettings.diagnosticsDescription', language)}</p>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-xs text-text-secondary">{t('systemSettings.diagnosticsHeap', language)}</div>
          <p className="text-xs text-text-muted mt-1 leading-relaxed">{t('systemSettings.diagnosticsHeapHint', language)}</p>
        </div>
        <Switch checked={includeHeapProfiling} disabled={pending !== null}
          aria-label={t('systemSettings.diagnosticsHeap', language)}
          onChange={event => setIncludeHeapProfiling(event.target.checked)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" disabled={pending !== null} onClick={() => void capture('memory')}>
          <Download className="w-3.5 h-3.5 mr-1.5" />
          {t('systemSettings.diagnosticsMemory', language)}
        </Button>
        <Button variant="secondary" size="sm" disabled={pending !== null} onClick={() => void capture('trace')}>
          <Activity className="w-3.5 h-3.5 mr-1.5" />
          {t('systemSettings.diagnosticsTrace', language)}
        </Button>
      </div>
      {pending && <p role="status" className="text-xs text-accent">{t('systemSettings.diagnosticsRecording', language)}</p>}
    </div>
  )
}
