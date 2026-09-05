import { t, type Language } from '@shared/i18n'
import { Button, Switch } from '@components/ui'
import { useState, useEffect } from 'react'
import { FileText, AlertTriangle, Download, ExternalLink } from 'lucide-react'
import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { toast } from '@components/common/ToastProvider'
import { DiagnosticsSettings } from './DiagnosticsSettings'
export function LogSettings({
  language,
  enableFileLogging,
  setEnableFileLogging,
}: {
  language: Language
  enableFileLogging: boolean
  setEnableFileLogging: (value: boolean) => void
}) {
  const [logPath, setLogPath] = useState('')
  useEffect(() => {
    const getLogPath = async () => {
      try {
        const userDataPath = await api.settings.getUserDataPath()
        if (userDataPath) {
          setLogPath(`${userDataPath}/logs/main.log`)
        }
      } catch (err) {
        logger.settings.error('Failed to get log path:', err)
      }
    }
    getLogPath()
  }, [])
  const handleToggleFileLogging = (enabled: boolean) => {
    setEnableFileLogging(enabled)
  }

  const handleOpenLogFile = async () => {
    if (!logPath) return
    const shown = await api.file.showInFolder(logPath)
    if (!shown) toast.error(t('systemSettings.couldNotLocateThe', language))
  }

  const handleExportLogs = async () => {
    try {
      const logs = await api.settings.getRecentLogs()
      if (logs) {
        const blob = new Blob([logs], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `adnify-logs-${new Date().toISOString().slice(0, 10)}.log`
        a.click()
        URL.revokeObjectURL(url)
        toast.success(t('systemSettings.logsExported', language))
      } else {
        toast.error(t('systemSettings.noLogsToExport', language))
      }
    } catch (err) {
      logger.settings.error('Failed to export logs:', err)
      toast.error(t('systemSettings.failedToExportLogs', language))
    }
  }
  return (
    <div className="space-y-6 animate-fade-in pb-10">
      <section>
        <div className="flex items-center gap-2 mb-3 ml-1">
          <FileText className="w-4 h-4 text-accent" />
          <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-[0.14em]">
            {t('systemSettings.logManagement', language)}
          </h4>
        </div>
        <div className="space-y-4">
          <div className="rounded-xl border border-border/70 bg-surface/25 p-5 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-text-primary">
                  {t('systemSettings.enableFileLogging', language)}
                </div>
                <div className="text-xs text-text-muted mt-1 opacity-70">
                  {t('systemSettings.saveApplicationLogsTo', language)}
                </div>
              </div>
              <Switch checked={enableFileLogging} onChange={(e) => handleToggleFileLogging(e.target.checked)} />
            </div>

            {enableFileLogging && (
              <>
                <div>
                  <div className="text-sm font-bold text-text-primary mb-3">
                    {t('systemSettings.logFileLocation', language)}
                  </div>
                  {logPath && (
                    <div className="flex items-center gap-3 p-4 bg-background/50 rounded-xl border border-border shadow-inner">
                      <div className="p-1.5 bg-white/5 rounded-lg">
                        <FileText className="w-4 h-4 text-text-muted" />
                      </div>
                      <div className="text-xs text-text-secondary font-mono break-all opacity-90 flex-1">{logPath}</div>
                    </div>
                  )}
                </div>

                <div className="flex gap-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleOpenLogFile}
                    disabled={!logPath}
                    className="rounded-xl px-4 flex-1"
                  >
                    <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                    {t('revealInExplorer', language)}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={handleExportLogs} className="rounded-xl px-4 flex-1">
                    <Download className="w-3.5 h-3.5 mr-1.5" />
                    {t('systemSettings.exportLogs', language)}
                  </Button>
                </div>

                <div className="flex items-start gap-2 text-[10px] font-medium text-blue-500 bg-blue-500/10 px-3 py-2 rounded-lg border border-blue-500/20">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <div>{t('systemSettings.logFilesRotateAutomatically', language)}</div>
                </div>
              </>
            )}

            {!enableFileLogging && (
              <div className="flex items-start gap-2 text-[10px] font-medium text-text-muted bg-white/5 px-3 py-2 rounded-lg border border-border">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <div>{t('systemSettings.fileLoggingIsDisabled', language)}</div>
              </div>
            )}
          </div>
          <DiagnosticsSettings language={language} />
        </div>
      </section>
    </div>
  )
}
