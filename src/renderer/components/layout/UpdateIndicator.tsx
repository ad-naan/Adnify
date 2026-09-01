/**
 * Update indicator shown in the top bar.
 */

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowUpCircle, CheckCircle, Download, ExternalLink, Loader2, RefreshCw, X, BookOpen } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { updaterService, type UpdateStatus } from '@services/updaterService'
import { useStore } from '@store'
import { api } from '@/renderer/services/electronAPI'
import { t } from '@shared/i18n'

export default function UpdateIndicator() {
  const language = useStore(state => state.language)
  const setShowChangelog = useStore(state => state.setShowChangelog)
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [showPopover, setShowPopover] = useState(false)
  const [currentVersion, setCurrentVersion] = useState('')
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    updaterService.initialize()
    const unsubscribe = updaterService.subscribe(setStatus)
    void updaterService.getStatus().then(setStatus)
    void api.getAppVersion().then(setCurrentVersion)
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setShowPopover(false)
      }
    }

    if (showPopover) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showPopover])

  const handleCheck = async () => updaterService.checkForUpdates()

  const handleDownload = async () => {
    if (status?.requiresManualDownload) {
      updaterService.openDownloadPage()
      return
    }

    await updaterService.downloadUpdate()
  }

  const handleInstall = () => updaterService.installAndRestart()

  const hasUpdate = status?.status === 'available' || status?.status === 'downloaded'
  const isChecking = status?.status === 'checking'
  const isDownloading = status?.status === 'downloading'
  const isError = status?.status === 'error'

  const labels = {
    title: t('updateIndicator.systemUpdate', language),
    checking: t('updateIndicator.checkingForUpdates', language),
    available: t('updateIndicator.newVersionAvailable', language),
    downloaded: t('updateIndicator.updateReady', language),
    downloading: t('updateIndicator.downloadingUpdate', language),
    notAvailable: t('updateIndicator.youAreUpTo', language),
    error: t('updateIndicator.updateFailed', language),
    download: t('updateIndicator.updateNow', language),
    install: t('updateIndicator.restartToApply', language),
    openPage: t('updateIndicator.openDownloadPage', language),
    checkNow: t('updateIndicator.checkForUpdates', language),
    manualHint:
      t('updateIndicator.thisIsAPortable', language),
    mirrorHint:
      t('updateIndicator.githubDownloadAccelerationIs', language),
    current: t('updateIndicator.current', language),
  }

  return (
    <div className="relative z-50" ref={popoverRef}>
      <button
        onClick={() => setShowPopover(!showPopover)}
        className={`relative flex items-center justify-center w-8 h-8 rounded-full transition-all duration-300 group ${
          hasUpdate
            ? 'bg-accent/10 text-accent ring-1 ring-accent/20 hover:bg-accent/20 hover:shadow-[0_0_15px_-3px_rgba(var(--accent),0.3)]'
            : isError
              ? 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20 hover:bg-red-500/20'
              : showPopover
                ? 'bg-surface text-text-primary'
                : 'text-text-muted hover:text-text-primary hover:bg-white/5'
        }`}
        title={hasUpdate ? labels.available : labels.checkNow}
      >
        {isChecking || isDownloading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : hasUpdate ? (
          <ArrowUpCircle className="w-4 h-4" />
        ) : isError ? (
          <AlertCircle className="w-4 h-4" />
        ) : (
          <Download className="w-4 h-4 opacity-70 group-hover:opacity-100" />
        )}

        {hasUpdate && <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-accent rounded-full border-2 border-background animate-pulse" />}
      </button>

      <AnimatePresence>
        {showPopover && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute right-0 top-full mt-2 w-[300px] rounded-2xl bg-[rgb(var(--background-secondary))] border border-[rgb(var(--border))] shadow-2xl overflow-hidden origin-top-right select-none z-50"
          >
            {/* 顶栏 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[rgb(var(--border)/0.6)] bg-[rgb(var(--background-tertiary)/0.5)]">
              <span className="text-[12px] font-semibold text-[rgb(var(--text-primary))]">{labels.title}</span>
              <button
                onClick={() => setShowPopover(false)}
                className="p-1 rounded-md text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text-primary))] hover:bg-[rgb(var(--surface-hover))] transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="p-5 flex flex-col items-center text-center">
              {/* 图标 */}
              <div className="mb-3">
                <div
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center border transition-all ${
                    hasUpdate
                      ? 'bg-[rgb(var(--accent)/0.12)] text-[rgb(var(--accent))] border-[rgb(var(--accent)/0.25)]'
                      : isChecking || isDownloading
                        ? 'bg-[rgb(var(--accent)/0.1)] text-[rgb(var(--accent))] border-[rgb(var(--accent)/0.2)]'
                        : isError
                          ? 'bg-rose-500/10 text-rose-500 border-rose-500/20'
                          : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                  }`}
                >
                  {isChecking || isDownloading ? (
                    <Loader2 className="w-6 h-6 animate-spin" />
                  ) : hasUpdate ? (
                    <ArrowUpCircle className="w-6 h-6" />
                  ) : isError ? (
                    <AlertCircle className="w-6 h-6" />
                  ) : (
                    <CheckCircle className="w-6 h-6" />
                  )}
                </div>
              </div>

              {/* 标题 */}
              <h4 className="text-[15px] font-semibold text-[rgb(var(--text-primary))]">
                {status?.status === 'available'
                  ? labels.available
                  : status?.status === 'downloaded'
                    ? labels.downloaded
                    : status?.status === 'downloading'
                      ? labels.downloading
                      : status?.status === 'checking'
                        ? labels.checking
                        : status?.status === 'error'
                          ? labels.error
                          : labels.notAvailable}
              </h4>

              {/* 版本号 */}
              <div className="mt-1.5 mb-4 text-[12px] text-[rgb(var(--text-muted))]">
                {status?.version && hasUpdate ? (
                  <span>
                    v{currentVersion} <span className="text-[rgb(var(--text-muted)/0.4)]">→</span> <span className="text-[rgb(var(--accent))] font-medium">v{status.version}</span>
                  </span>
                ) : (
                  <span>{labels.current}: v{currentVersion}</span>
                )}
              </div>

              {/* 下载进度条 */}
              {isDownloading && status?.progress !== undefined && (
                <div className="w-full mb-4 p-2.5 rounded-xl bg-[rgb(var(--surface))] border border-[rgb(var(--border)/0.6)] space-y-1.5 text-left">
                  <div className="flex justify-between text-[11px] font-medium text-[rgb(var(--text-muted))]">
                    <span>{labels.downloading}</span>
                    <span className="text-[rgb(var(--accent))] font-bold">{status.progress.toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-[rgb(var(--surface-active))] rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-[rgb(var(--accent))] rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${status.progress}%` }}
                      transition={{ ease: 'easeOut' }}
                    />
                  </div>
                </div>
              )}

              {/* 加速镜像提示 */}
              {status?.usingDownloadMirror && (
                <div className="w-full mb-4 px-3 py-2 rounded-xl bg-[rgb(var(--surface))] border border-[rgb(var(--border)/0.5)] text-[11px] text-[rgb(var(--text-secondary))] leading-relaxed text-left">
                  {labels.mirrorHint}
                </div>
              )}

              {/* 便携版提示 */}
              {hasUpdate && status?.requiresManualDownload && (
                <div className="w-full mb-4 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed text-left">
                  {labels.manualHint}
                </div>
              )}

              {/* 按钮区域 */}
              <div className="w-full space-y-2">
                {hasUpdate ? (
                  status?.status === 'downloaded' ? (
                    <button
                      onClick={handleInstall}
                      className="w-full h-9 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[13px] font-medium transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-sm"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>{labels.install}</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleDownload}
                      className="w-full h-9 rounded-xl bg-[rgb(var(--accent))] hover:bg-[rgb(var(--accent-hover))] text-white text-[13px] font-medium transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-sm"
                    >
                      {status?.requiresManualDownload ? <ExternalLink className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                      <span>{status?.requiresManualDownload ? labels.openPage : labels.download}</span>
                    </button>
                  )
                ) : (
                  !isChecking &&
                  !isDownloading && (
                    <button
                      onClick={handleCheck}
                      className="w-full h-9 rounded-xl bg-[rgb(var(--surface))] hover:bg-[rgb(var(--surface-hover))] border border-[rgb(var(--border))] text-[rgb(var(--text-primary))] text-[13px] font-medium transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-[rgb(var(--text-muted))]" />
                      <span>{labels.checkNow}</span>
                    </button>
                  )
                )}

                <button
                  type="button"
                  onClick={() => {
                    setShowPopover(false)
                    setShowChangelog(true, status?.version || currentVersion)
                  }}
                  className="w-full py-1 text-[12px] text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text-primary))] flex items-center justify-center gap-1.5 transition-colors"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>{t('common.viewChangelog', language)}</span>
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
