/**
 * 状态栏里的本地服务面板内容。
 *
 * 取代原来"发现即弹卡片"的交互：发现结果常驻在这里，需要时点开，
 * 不打断正在做的事。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, Globe, RefreshCw } from 'lucide-react'
import { useStore } from '@store'
import { api } from '@/renderer/services/electronAPI'
import { t, type Language } from '@/renderer/i18n'
import { devServerDiscoveryService } from '@/renderer/preview/devServerDiscoveryService'
import { previewSessionService } from '@/renderer/preview/previewSessionService'
import {
  clearDismissedOrigins,
  loadPreviewSettings,
  subscribePreviewSettings,
  updatePreviewSettings,
} from '@/renderer/preview/previewSettings'
import { Switch } from '../ui'
import type { PreviewServerCandidate, PreviewServerStatus } from '@shared/types/preview'

const STATUS_DOT: Record<PreviewServerStatus, string> = {
  ready: 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]',
  probing: 'bg-amber-400 animate-pulse',
  unreachable: 'bg-text-muted/40',
  idle: 'bg-text-muted/25',
}

function statusLabel(status: PreviewServerStatus, language: Language): string {
  switch (status) {
    case 'ready': return t('preview.servers.status.ready', language)
    case 'probing': return t('preview.servers.status.probing', language)
    case 'unreachable': return t('preview.servers.status.unreachable', language)
    default: return t('preview.servers.status.idle', language)
  }
}

export default function LocalServersContent({ language }: { language: Language }) {
  const workspaceRoots = useStore((state) => state.workspace?.roots)
  const [state, setState] = useState(() => devServerDiscoveryService.getState())
  const [previewSettings, setPreviewSettings] = useState(loadPreviewSettings)

  useEffect(() => devServerDiscoveryService.subscribe(setState), [])
  useEffect(() => subscribePreviewSettings(setPreviewSettings), [])

  const rescan = useCallback(() => {
    if (!workspaceRoots?.length) return
    void devServerDiscoveryService.refresh(workspaceRoots, { force: true })
  }, [workspaceRoots])

  const openPreview = useCallback((candidate: PreviewServerCandidate) => {
    previewSessionService.openCandidate(candidate, { activate: true })
  }, [])

  const candidates = useMemo(
    () => devServerDiscoveryService.getCandidatesForWorkspace(workspaceRoots?.[0]),
    [state, workspaceRoots],
  )

  return (
    <div className="flex flex-col h-full text-xs">
      <div className="flex items-center justify-between gap-2 px-1 pb-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-text-muted">
          {state.lastScanAt
            ? t('preview.servers.lastScan', language, { time: new Date(state.lastScanAt).toLocaleTimeString() })
            : ''}
        </span>
        <button
          onClick={rescan}
          disabled={!workspaceRoots?.length || state.scanning}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${state.scanning ? 'animate-spin' : ''}`} />
          {state.scanning ? t('preview.servers.scanning', language) : t('preview.servers.rescan', language)}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
        {candidates.length === 0 ? (
          <div className="px-2 py-6 text-center">
            <Globe className="mx-auto mb-2 h-6 w-6 text-text-muted/50" />
            <p className="text-[11px] font-medium text-text-secondary">{t('preview.servers.empty', language)}</p>
            <p className="mt-1 text-[10px] leading-relaxed text-text-muted">{t('preview.servers.emptyHint', language)}</p>
          </div>
        ) : candidates.map((candidate) => (
          <div
            key={candidate.id}
            className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/5"
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[candidate.status]}`} />

            <button
              onClick={() => openPreview(candidate)}
              className="min-w-0 flex-1 text-left"
              title={candidate.error || candidate.url}
            >
              <div className="truncate text-[11px] font-medium text-text-primary">{candidate.label || candidate.url}</div>
              <div className="truncate text-[10px] text-text-muted">
                {statusLabel(candidate.status, language)}
                {candidate.title && candidate.status === 'ready' ? ` · ${candidate.title}` : ''}
              </div>
            </button>

            <button
              onClick={() => openPreview(candidate)}
              className="shrink-0 rounded-md p-1 text-text-muted opacity-0 transition-all hover:bg-white/10 hover:text-text-primary group-hover:opacity-100"
              title={t('preview.servers.openPreview', language)}
            >
              <Globe className="h-3 w-3" />
            </button>

            <button
              onClick={() => void api.preview.openExternal(candidate.url)}
              className="shrink-0 rounded-md p-1 text-text-muted opacity-0 transition-all hover:bg-white/10 hover:text-text-primary group-hover:opacity-100"
              title={t('preview.servers.openExternal', language)}
            >
              <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-2 border-t border-border/40 pt-2">
        <label className="flex items-center justify-between gap-2 px-1 cursor-pointer">
          <span className="text-[10px] leading-snug text-text-muted">{t('preview.servers.autoPrompt', language)}</span>
          <Switch
            checked={previewSettings.autoPrompt}
            onChange={(event) => updatePreviewSettings({ autoPrompt: event.target.checked })}
            className="scale-[0.6] origin-right"
          />
        </label>
        {previewSettings.dismissedOrigins.length > 0 && (
          <button
            type="button"
            onClick={clearDismissedOrigins}
            className="mt-1 w-full rounded-md px-1 py-1 text-left text-[10px] text-text-muted transition-colors hover:bg-white/5 hover:text-text-primary"
          >
            {language === 'zh'
              ? `清除 ${previewSettings.dismissedOrigins.length} 个已忽略地址`
              : `Clear ${previewSettings.dismissedOrigins.length} muted address(es)`}
          </button>
        )}
      </div>
    </div>
  )
}
