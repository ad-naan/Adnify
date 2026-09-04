import { useEffect, useId, useState, type ReactNode } from 'react'
import { Box, ChevronDown, ChevronLeft, ChevronRight, Download, FolderOpen, Image as ImageIcon, Info, Loader2, Music2, Video, CircleAlert } from 'lucide-react'
import { assetService } from '@services/assetService'
import type { AssetJobSummary, GeneratedAsset, AssetKind } from '@shared/types/assets'
import { useStore } from '@store'
import { t, type TranslationKey, type Language } from '@shared/i18n'
import { ImageLightbox } from './ImageLightbox'
import { ToolElapsedTime } from './ToolActivityIndicator'
import { Modal } from '@components/ui'

const actionClass = 'inline-flex items-center gap-1 p-1 text-text-muted hover:text-text-primary hover:bg-surface-elevated rounded transition-colors disabled:opacity-40'
export const assetKindKeys = { image: 'assets.image', video: 'assets.video', model3d: 'assets.model3d', audio: 'assets.audio', file: 'assets.file' } as const
export const assetStateKeys = {
  queued: 'assets.queued', submitting: 'assets.submitting', running: 'assets.running', collecting: 'assets.collecting',
  ready: 'assets.ready', failed: 'assets.failed', submission_unknown: 'assets.submission_unknown', cancelled: 'assets.cancelled',
} satisfies Record<AssetJobSummary['state'], TranslationKey>

export function assetFailureText(job: AssetJobSummary, language: Language): string | undefined {
  const failure = job.failure
  if (!failure) return job.state === 'submission_unknown' ? t('assets.errorLegacyUnknown', language) : job.error
  if (failure.kind === 'http') {
    if (failure.detail) return t('assets.errorServiceDetail', language, { status: failure.status, detail: failure.detail })
    if (failure.status === 401 || failure.status === 403) return t('assets.errorAuth', language, { status: failure.status })
    if (failure.status === 429) return t('assets.errorRateLimit', language)
    return t('assets.errorHttp', language, { status: failure.status })
  }
  if (failure.kind === 'timeout') return t('assets.errorTimeout', language)
  if (failure.kind === 'network') return t('assets.errorNetwork', language, { code: failure.code || '—' })
  if (failure.kind === 'credential') return t('assets.errorCredentialFormat', language)
  if (failure.code === 'size_limit') return t('assets.errorResponseSize', language)
  return t('assets.errorResponseJson', language)
}

export const assetIcons = { image: ImageIcon, video: Video, audio: Music2, model3d: Box, file: Box }

/** The asset keeps its own flat canvas when folded; it never becomes a generic tool row. */
export function AssetCanvas({ title, trailing, children, footer, actions, collapsedLabel, kind = 'image' }: { title?: string; trailing?: ReactNode; children: ReactNode; footer?: ReactNode; actions?: ReactNode; collapsedLabel?: string; kind?: AssetKind }) {
  const language = useStore(state => state.language)
  const [collapsed, setCollapsed] = useState(false)
  const contentId = useId()
  const Icon = assetIcons[kind]
  const summary = collapsedLabel || t(assetKindKeys[kind], language)
  return <section data-asset-canvas aria-label={title || t('assets.preview', language)} className={`group/asset relative w-full overflow-hidden text-xs ${collapsed ? 'my-0.5 rounded-lg hover:bg-text-primary/[0.02]' : 'my-2 max-w-[440px] rounded bg-surface-hover/50'}`}>
    {!collapsed && <div data-asset-controls className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded bg-surface/95 p-1 text-text-muted transition-opacity motion-reduce:transition-none opacity-0 group-hover/asset:opacity-100 group-focus-within/asset:opacity-100">
      {trailing && <span className="px-1 text-[10px]">{trailing}</span>}{actions}
      <button type="button" aria-label={t(collapsed ? 'assets.expandCanvas' : 'assets.collapseCanvas', language)} aria-expanded={!collapsed} aria-controls={contentId} title={t(collapsed ? 'assets.expandCanvas' : 'assets.collapseCanvas', language)} onClick={() => setCollapsed(value => !value)} className={`${actionClass} focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent`}><ChevronDown size={14} aria-hidden="true" className={`transition-transform motion-reduce:transition-none ${collapsed ? '-rotate-90' : ''}`} /></button>
    </div>}
    {collapsed && <div className="flex min-h-9 items-center gap-2">
      <button type="button" aria-label={t('assets.expandCanvas', language)} aria-expanded={false} aria-controls={contentId} onClick={() => setCollapsed(false)} className="flex min-h-9 min-w-0 flex-1 items-center gap-2 py-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"><ChevronRight size={14} className="shrink-0 text-text-muted/40" /><Icon size={14} className="shrink-0 text-text-muted/55" /><span className="min-w-0 flex-1 truncate text-[12px] font-normal text-text-secondary" title={summary}>{summary}</span><span className="shrink-0 text-text-muted">{trailing}</span></button>
      <span className="mr-1 flex shrink-0 items-center text-text-muted opacity-0 group-hover/asset:opacity-100 group-focus-within/asset:opacity-100">{actions}</span>
    </div>}
    <div id={contentId} hidden={collapsed}>
      {!collapsed && children}
      {!collapsed && footer && <footer className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-[10px] text-text-muted">{footer}</footer>}
    </div>
  </section>
}

export function AssetPlaceholder({ kind = 'image', label, busy, error, children }: { kind?: AssetKind; label: string; busy?: boolean; error?: string; children?: ReactNode }) {
  const Icon = assetIcons[kind]
  return <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 px-6 py-8 text-center" aria-busy={busy}>
    <div className="flex h-14 w-16 items-center justify-center text-text-muted/60">{busy ? <Loader2 size={24} strokeWidth={1.5} className="animate-spin motion-reduce:animate-none text-text-muted" /> : <Icon size={25} strokeWidth={1.2} />}</div>
    <p role="status" aria-live="polite" className="text-xs text-text-secondary">{label}</p>
    {error && <p role="alert" className="max-h-32 overflow-y-auto whitespace-pre-wrap text-[11px] leading-5 text-text-secondary [overflow-wrap:anywhere]">{error}</p>}
    {children}
  </div>
}

export function AssetPreview({ id, embedded = false, navigation }: { id: string; embedded?: boolean; navigation?: ReactNode }) {
  const language = useStore(s => s.language)
  const [preview, setPreview] = useState<string | null>(null)
  const [media, setMedia] = useState<{ asset: GeneratedAsset; url?: string }>()
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    setPreview(null); setMedia(undefined); setError(''); setExpanded(false)
    void (async () => {
      const value = await assetService.request<{ asset: GeneratedAsset; url?: string }>({ type: 'mediaPreview', id })
      if (!live) return
      setMedia(value)
      if (value.asset.kind === 'image') {
        const image = await assetService.request<string | null>({ type: 'preview', id })
        if (live) setPreview(image)
      }
    })().catch(e => { if (live) setError(String(e.message)) })
    return () => { live = false }
  }, [id])
  const act = async (type: 'export' | 'openAsset') => {
    setBusy(true)
    try { setError(''); await assetService.request({ type, id }) } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  const asset = media?.asset
  const Icon = assetIcons[asset?.kind || 'image']
  const content = <div className="relative">
    {preview && <button className="flex min-h-[220px] w-full cursor-zoom-in items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" onClick={() => setExpanded(true)} aria-label={t('assets.preview', language)}><img src={preview} alt={asset?.name || t('assets.preview', language)} className="max-h-[360px] w-full object-contain" /></button>}
    {media?.url && asset?.kind === 'video' && <video aria-label={t('assets.preview', language)} src={media.url} controls playsInline preload="metadata" className="max-h-[360px] min-h-[220px] w-full" onError={() => setError(t('assets.mediaError', language))} />}
    {media?.url && asset?.kind === 'audio' && <div className="flex min-h-[220px] flex-col items-center justify-center gap-6 p-5"><Music2 size={36} strokeWidth={1} className="text-text-muted" /><audio aria-label={t('assets.preview', language)} src={media.url} controls preload="metadata" className="w-full" onError={() => setError(t('assets.mediaError', language))} /></div>}
    {(!media || (asset?.kind === 'image' && !preview)) && !error && <AssetPlaceholder label={t('assets.loadingPreview', language)} busy />}
    {asset && asset.kind !== 'image' && !media?.url && <AssetPlaceholder kind={asset.kind} label={asset.name} error={t('assets.mediaError', language)} />}
    {error && <div role="alert" className="flex items-start gap-2 p-3 text-[11px] text-text-secondary"><CircleAlert size={14} className="shrink-0 text-status-error" />{error}</div>}
    <div data-asset-controls className={`absolute ${asset?.kind === 'video' ? 'bottom-14' : 'bottom-2'} left-2 right-2 flex flex-wrap items-center gap-2 rounded bg-surface/95 px-2 py-1.5 text-[10px] text-text-muted opacity-0 transition-opacity group-hover/asset:opacity-100 group-focus-within/asset:opacity-100 motion-reduce:transition-none`}>
      <Icon size={12} aria-hidden="true" /><span>{asset ? t(assetKindKeys[asset.kind], language) : t('assets.preview', language)}</span>
      {asset?.width && asset.height && <span>{asset.width} × {asset.height}</span>}
      {asset && <span>{(asset.bytes / 1024 / 1024).toFixed(2)} MB</span>}
      <div className="ml-auto flex gap-1">
        {navigation}
        <button disabled={busy} onClick={() => void act('export')} className={actionClass} aria-label={t('assets.export', language)} title={t('assets.export', language)}><Download size={14} /></button>
        <button disabled={busy} onClick={() => void act('openAsset')} className={actionClass} aria-label={t('assets.showFile', language)} title={t('assets.showFile', language)}><FolderOpen size={14} /></button>
      </div>
    </div>
    <ImageLightbox isOpen={expanded} src={preview} alt={t('assets.preview', language)} onClose={() => setExpanded(false)} />
  </div>
  return embedded ? <div>{content}</div> : <AssetCanvas title={asset?.name || t('assets.preview', language)} collapsedLabel={asset?.name} kind={asset?.kind}>{content}</AssetCanvas>
}

export function AssetJobCard({ jobId, hideHeader = false, kind = 'image', title, prompt }: { jobId: string; hideHeader?: boolean; kind?: AssetKind; title?: string; prompt?: string }) {
  const language = useStore(s => s.language)
  const [job, setJob] = useState<AssetJobSummary>()
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const [details, setDetails] = useState(false)
  const [selected, setSelected] = useState(0)
  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout>
    setError('')
    const poll = async () => {
      try {
        const next = await assetService.request<AssetJobSummary>({ type: 'job', id: jobId })
        if (!live) return
        setJob(next); setError('')
        if (['queued', 'submitting', 'running', 'collecting'].includes(next.state)) timer = setTimeout(poll, 3000)
      } catch (e) { if (live) setError((e as Error).message) }
    }
    void poll()
    return () => { live = false; clearTimeout(timer) }
  }, [jobId, refresh])
  const act = async (type: 'cancel' | 'retryCollection') => {
    setBusy(true)
    try { setJob(await assetService.request<AssetJobSummary>({ type, id: jobId })); setRefresh(n => n + 1) }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  const active = !!job && ['queued', 'submitting', 'running', 'collecting'].includes(job.state)
  const failure = error || (job && assetFailureText(job, language))
  const label = job ? t(assetStateKeys[job.state], language) : t('assets.preparing', language)
  const index = Math.min(selected, Math.max(0, (job?.assetIds.length || 0) - 1))
  return <>
    <AssetCanvas title={hideHeader ? undefined : job?.capabilityName || title || t('assets.job', language)} collapsedLabel={job?.prompt || prompt} kind={kind} trailing={<ToolElapsedTime state={active ? 'running' : 'idle'} startedAt={job?.createdAt} durationMs={job ? job.updatedAt - job.createdAt : undefined} className="!text-text-muted" />} actions={<button className={actionClass} onClick={() => setDetails(true)} title={t('assets.details', language)} aria-label={t('assets.details', language)}><Info size={13} /></button>} footer={job?.state === 'queued' || job?.canRetryCollection || error ? <>
      <div className="flex items-center gap-2">
        {job?.state === 'queued' && <button disabled={busy} className={actionClass} onClick={() => void act('cancel')}>{t('assets.cancelQueued', language)}</button>}
        {job?.canRetryCollection && <button disabled={busy} className={actionClass} onClick={() => void act('retryCollection')}>{t('assets.retryDownload', language)}</button>}
        {error && <button className={actionClass} onClick={() => setRefresh(n => n + 1)}>{t('assets.refresh', language)}</button>}
      </div>
    </> : undefined}>
      {job?.assetIds.length ? <>
        <AssetPreview key={job.assetIds[index]} id={job.assetIds[index]} embedded navigation={job.assetIds.length > 1 && <div className="mr-2 flex items-center gap-1 text-[10px] text-text-muted"><button className={actionClass} disabled={index === 0} onClick={() => setSelected(index - 1)} aria-label={t('assets.historyPrevious', language)}><ChevronLeft size={13} /></button><span>{index + 1} / {job.assetIds.length}</span><button className={actionClass} disabled={index === job.assetIds.length - 1} onClick={() => setSelected(index + 1)} aria-label={t('assets.historyNext', language)}><ChevronRight size={13} /></button></div>} />
        {failure && <p role="alert" className="px-3 py-2 text-[11px] text-text-secondary [overflow-wrap:anywhere]">{failure}</p>}
      </> : <AssetPlaceholder kind={kind} label={label} busy={active || !job && !error} error={failure}>
        {active && <p className="text-[11px] text-text-muted">{t('assets.canvasWaiting', language)}</p>}
      </AssetPlaceholder>}
    </AssetCanvas>
    <Modal isOpen={details} onClose={() => setDetails(false)} title={t('assets.details', language)} size="lg">
      <dl className="space-y-4 text-xs text-text-muted"><div><dt>{t('assets.jobId', language)}</dt><dd className="mt-1 select-all font-mono text-text-secondary break-all">{jobId}</dd></div><div><dt>{t('assets.storagePath', language)}</dt><dd className="mt-1 select-all font-mono text-text-secondary break-all">{job?.storageRoot}</dd></div></dl>
    </Modal>
  </>
}
