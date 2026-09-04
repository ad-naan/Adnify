import { useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Image, Loader2, Trash2, X } from 'lucide-react'
import { Button } from '@components/ui'
import { t, type Language } from '@shared/i18n'
import type { AssetAction, AssetHistoryKind, AssetHistoryPage, GeneratedAsset } from '@shared/types/assets'
import { assetService } from '@services/assetService'
import { AssetJobCard, AssetPreview, assetFailureText, assetStateKeys } from '@components/agent/AssetJobCard'

const activeStates = new Set(['queued', 'submitting', 'running', 'collecting'])
const iconButton = 'shrink-0 rounded p-1.5 text-text-muted transition-colors hover:bg-surface-elevated hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40'

export default function AssetHistory({ language }: { language: Language }) {
  const [kind, setKind] = useState<AssetHistoryKind>('jobs')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<AssetHistoryPage>()
  const [expanded, setExpanded] = useState<string>()
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        const next = await assetService.request<AssetHistoryPage>({ type: 'history', kind, page })
        if (live) {
          setData(next)
          if (next.page !== page) setPage(next.page)
        }
      } catch (e) { if (live) setError((e as Error).message) }
      finally { if (live) timer = setTimeout(load, 4000) }
    }
    void load()
    return () => { live = false; clearTimeout(timer) }
  }, [kind, page, revision])

  const act = async (action: AssetAction) => {
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await assetService.request<GeneratedAsset | null>(action)
      if (action.type === 'import' && result) {
        setNotice(`${t('assets.importedAssetID', language)}: ${result.id}`)
        setPage(1)
      }
      setExpanded(undefined)
      setRevision(value => value + 1)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  const changeKind = (next: AssetHistoryKind) => {
    if (next === kind) return
    setKind(next); setPage(1); setData(undefined); setExpanded(undefined); setError(''); setNotice('')
  }
  const changePage = (next: number) => { setPage(next); setData(undefined); setExpanded(undefined) }
  const toggle = (id: string) => setExpanded(value => value === id ? undefined : id)
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const removeButton = (id: string) => <button className={`${iconButton} hover:!text-status-error`} disabled={busy} title={t('assets.historyRemove', language)} aria-label={t('assets.historyRemove', language)} onClick={() => void act({ type: 'removeHistory', kind, id })}><Trash2 size={14} /></button>

  return <div className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60">
      <div role="tablist" className="flex gap-4">
        {(['jobs', 'references'] as const).map(value => <button key={value} role="tab" aria-selected={kind === value} disabled={busy} onClick={() => changeKind(value)} className={`border-b-2 py-2 text-xs font-medium transition-colors ${kind === value ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary'}`}>
          {t(value === 'jobs' ? 'assets.historyTasks' : 'assets.historyReferences', language)}
        </button>)}
      </div>
      <div className="flex items-center gap-1 pb-1">
        {kind === 'references' && <Button variant="ghost" size="sm" disabled={busy} leftIcon={<Image size={13} />} onClick={() => void act({ type: 'import' })}>{t('assets.importImage', language)}</Button>}
        <Button variant="ghost" size="sm" disabled={busy || !data?.clearable} leftIcon={<Trash2 size={13} />} onClick={() => void act({ type: 'clearHistory', kind })}>{t(kind === 'jobs' ? 'assets.historyClearTasks' : 'assets.historyClearReferences', language)}</Button>
      </div>
    </div>
    {error && <p role="alert" className="text-xs text-status-error break-words">{error}</p>}
    {notice && <p role="status" className="text-xs text-text-muted break-all">{notice}</p>}
    <div className="max-h-[360px] overflow-y-auto overscroll-contain custom-scrollbar" role="tabpanel" aria-label={t(kind === 'jobs' ? 'assets.historyTasks' : 'assets.historyReferences', language)}>
      {!data ? <div className="flex justify-center py-6"><Loader2 size={16} className="animate-spin text-text-muted" /></div> : !data.total ? <p className="py-6 text-center text-xs text-text-muted">{t('assets.historyEmpty', language)}</p> : <div className="divide-y divide-border/50">
        {data.jobs.map(job => {
          const active = activeStates.has(job.state)
          const unknown = job.state === 'submission_unknown'
          const Icon = active ? Loader2 : unknown ? CircleHelp : job.state === 'ready' ? Check : job.state === 'failed' ? X : Clock3
          const failure = assetFailureText(job, language)
          return <div key={job.id}>
            <div className="flex items-center gap-2 py-2">
              <button className="flex min-w-0 flex-1 items-center gap-2 rounded py-1 text-left hover:bg-surface/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" aria-expanded={expanded === job.id} onClick={() => toggle(job.id)}>
                <Icon size={14} className={`shrink-0 ${active ? 'animate-spin text-accent' : job.state === 'failed' ? 'text-status-error' : 'text-text-muted'}`} />
                <div className="min-w-0 flex-1"><div className="flex items-baseline gap-2"><span className="truncate text-xs font-medium text-text-primary">{job.capabilityName}</span><span className="shrink-0 text-[10px] text-text-muted">{t(unknown ? 'assets.historyUnknown' : assetStateKeys[job.state], language)}</span></div>
                  {failure && expanded !== job.id && <p className="mt-1 truncate text-[11px] text-text-muted">{failure}</p>}
                </div>
                <span className="shrink-0 text-[10px] tabular-nums text-text-muted">{((job.updatedAt - job.createdAt) / 1000).toFixed(1)}s</span>
                <ChevronDown size={13} className={`shrink-0 text-text-muted transition-transform ${expanded === job.id ? 'rotate-180' : ''}`} />
              </button>
              {!active && removeButton(job.id)}
            </div>
            {expanded === job.id && <div className="pb-3 pl-6 pr-2"><AssetJobCard jobId={job.id} hideHeader /></div>}
          </div>
        })}
        {data.assets.map(asset => <div key={asset.id}>
          <div className="flex items-center gap-2 py-2">
            <button className="flex min-w-0 flex-1 items-center gap-2 rounded py-1 text-left hover:bg-surface/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" aria-expanded={expanded === asset.id} onClick={() => toggle(asset.id)}>
              <Image size={14} className="shrink-0 text-text-muted" /><span className="min-w-0 flex-1 truncate text-xs text-text-primary">{asset.name}</span><span className="shrink-0 text-[10px] text-text-muted">{(asset.bytes / 1024 / 1024).toFixed(2)} MB</span><ChevronDown size={13} className={`shrink-0 text-text-muted transition-transform ${expanded === asset.id ? 'rotate-180' : ''}`} />
            </button>
            {removeButton(asset.id)}
          </div>
          {expanded === asset.id && <div className="pb-3 pl-6 pr-2"><AssetPreview id={asset.id} /></div>}
        </div>)}
      </div>}
    </div>
    <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2 text-[10px] text-text-muted">
      <span>{t('assets.historyPage', language, { total: data?.total ?? 0, page: data?.page ?? page, pages })}</span>
      <div className="flex items-center gap-1"><button className={iconButton} disabled={busy || !data || data.page <= 1} title={t('assets.historyPrevious', language)} aria-label={t('assets.historyPrevious', language)} onClick={() => changePage(page - 1)}><ChevronLeft size={14} /></button><button className={iconButton} disabled={busy || !data || data.page >= pages} title={t('assets.historyNext', language)} aria-label={t('assets.historyNext', language)} onClick={() => changePage(page + 1)}><ChevronRight size={14} /></button></div>
    </div>
    <p className="text-[10px] leading-4 text-text-muted">{t('assets.historyKeepFiles', language)}</p>
  </div>
}
