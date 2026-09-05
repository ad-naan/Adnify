import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, Archive, Settings2 } from 'lucide-react'
import { api } from '@/renderer/services/electronAPI'
import { Modal } from '../ui/Modal'
import { EXECUTION_SETTING_RANGES, normalizeExecutionSettings, type ExecutionSettings } from '@shared/config/executionSettings'
import { t, toLocaleTag, type TranslationKey } from '@shared/i18n'
import { executionStatusLabel, executionReasonLabel } from '@shared/executionPresentation'
import { USER_PREFERENCE_KEYS } from '@/renderer/settings/preferenceKeys'
import type { ExecutionManagementAction, ExecutionOverview, ExecutionSnapshot } from '@shared/types/execution'

const fields: [keyof ExecutionSettings, TranslationKey, number?][] = [
  ['commands', 'execution.capacity.commands'],
  ['commandsPerWindow', 'execution.capacity.commandsPerWindow'],
  ['commandsPerThread', 'execution.capacity.commandsPerThread'],
  ['background', 'execution.capacity.background'],
  ['backgroundPerWindow', 'execution.capacity.backgroundPerWindow'],
  ['persistent', 'execution.capacity.persistent'],
  ['queued', 'execution.capacity.queued'],
  ['queuedPerWindow', 'execution.capacity.queuedPerWindow'],
  ['queuedPerThread', 'execution.capacity.queuedPerThread'],
  ['queueTimeoutMs', 'execution.capacity.queueTimeoutMs', 1000],
  ['outputBytes', 'execution.capacity.outputBytes', 1024],
  ['memoryBytes', 'execution.capacity.memoryBytes', 1024 * 1024],
  ['logBytes', 'execution.capacity.logBytes', 1024 * 1024],
  ['diskBytes', 'execution.capacity.diskBytes', 1024 * 1024],
  ['history', 'execution.capacity.history'],
  ['idleTimeoutMs', 'execution.capacity.idleTimeoutMs', 1000],
  ['idlePerWindow', 'execution.capacity.idlePerWindow'],
  ['idleGlobal', 'execution.capacity.idleGlobal'],
]
const button = 'rounded-lg border border-border/60 px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-hover disabled:opacity-40'



export function ExecutionManager({ language, onClose, initialTab = 'running' }: {
  language: 'zh' | 'en'; onClose: () => void; initialTab?: 'running' | 'history' | 'settings'
}) {
  const [tab, setTab] = useState(initialTab)
  const [overview, setOverview] = useState<ExecutionOverview>()
  const [draft, setDraft] = useState(() => normalizeExecutionSettings(undefined))
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('')
  const [log, setLog] = useState<{ id: string; title: string; output: string; truncated?: boolean }>()
  const dirty = useRef(false)
  const alive = useRef(true)
  const refresh = useCallback(async () => {
    const result = await api.execution.overview()
    if (!result.success) throw new Error(result.error || t('execution.loadFailed', language))
    if (!alive.current) return
    setOverview(result)
    if (!dirty.current) setDraft(result.settings)
  }, [language])
  useEffect(() => {
    alive.current = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try { await refresh() } catch (e) { if (alive.current) setError(String(e)) }
      if (alive.current) timer = setTimeout(poll, 2000)
    }
    void poll()
    return () => { alive.current = false; clearTimeout(timer) }
  }, [refresh])
  const act = async (id: string, action: ExecutionManagementAction, title = id) => {
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await api.execution.manage(id, action)
      if (!result.success) throw new Error(result.error || t('execution.operationFailed', language))
      if (action === 'log') setLog({ id, title, output: result.output || '', truncated: result.truncated })
      if (result.error) setError(result.error)
      if (action === 'export' && !result.cancelled) setNotice(t('execution.exported', language))
      if (action === 'delete' && log?.id === id) setLog(undefined)
      await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const save = async () => {
    setBusy(true); setError(''); setNotice('')
    try {
      const normalized = normalizeExecutionSettings(draft)
      if (!await api.settings.set(USER_PREFERENCE_KEYS.executionSettings.storageKey, normalized)) throw new Error(t('execution.saveFailed', language))
      dirty.current = false; setDraft(normalized)
      await refresh()
      setNotice(t('execution.saved', language))
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  const label = (value?: string) => executionReasonLabel(value, language)
  const rows = (tab === 'history' ? overview?.archives.filter(row => row.archived) : overview?.jobs) || []
  const visible = rows.filter(row => `${row.command} ${row.cwd} ${row.threadId}`.toLowerCase().includes(filter.toLowerCase()))
  const renderJob = (job: ExecutionSnapshot) => <article key={job.jobId} className="rounded-xl border border-border/60 p-3 space-y-2 bg-background/40">
    <div className="flex items-start justify-between gap-3">
      <code className="text-sm text-text-primary break-all whitespace-pre-wrap line-clamp-3" title={job.command}>{job.command}</code>
      <span className="text-xs shrink-0 text-accent">{executionStatusLabel(job.status, language)}</span>
    </div>
    <p className="text-xs text-text-muted break-all">{job.workspaceId || job.cwd} · {job.hosted ? (t('execution.hosted', language)) : `${t('execution.window', language)} ${job.ownerId ?? '—'}`} · {t('execution.task', language)} {job.threadId}</p>
    <p className="text-xs text-text-muted">{new Date(job.submittedAt).toLocaleString(toLocaleTag(language))} {job.exitCode !== null ? ` · ${t('execution.exitCode', language)} ${job.exitCode}` : ''}{job.consumers && job.consumers > 1 ? ` · ${job.consumers} ${t('execution.sharedWindowsSuffix', language)}` : ''}</p>
    {(job.waitingReason || job.reason) && <p className="text-xs text-amber-500">{label(job.waitingReason || job.reason)}</p>}
    {(job.logTruncated || job.logError) && <p className="text-xs text-amber-500">{job.logError || (t('execution.truncated', language))}</p>}
    <div className="flex flex-wrap gap-2">
      <button className={button} disabled={busy} onClick={() => void act(job.jobId, 'log', job.command)}>{t('execution.viewLog', language)}</button>
      <button className={button} disabled={busy} onClick={() => void act(job.jobId, 'export')}>{t('execution.export', language)}</button>
      {tab === 'running' ? <>
        <button className={button} disabled={busy || job.status === 'stopping'} onClick={() => void act(job.jobId, 'stop')}>{job.status === 'queued' ? (t('execution.cancelQueued', language)) : (t('execution.stop', language))}</button>
        {job.mode === 'background' && job.status === 'running' && <button className={button} disabled={busy} onClick={() => void act(job.jobId, job.hosted ? 'unhost' : 'host')}>{job.hosted ? (t('execution.unhost', language)) : (t('execution.host', language))}</button>}
      </> : <>
        <button className={button} disabled={busy} onClick={() => void act(job.jobId, job.pinned ? 'unpin' : 'pin')}>{job.pinned ? (t('execution.unpin', language)) : (t('execution.pin', language))}</button>
        <button className={button} disabled={busy || job.pinned} onClick={() => void act(job.jobId, 'delete')}>{t('execution.deleteArchive', language)}</button>
      </>}
    </div>
  </article>

  return <Modal isOpen onClose={onClose} title={t('execution.title', language)} size="5xl" className="max-h-[88vh]">
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">{t('execution.description', language)}</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        {overview && [[t('execution.commands', language), overview.usage.commands, overview.settings.commands], [t('execution.services', language), overview.usage.background, overview.settings.background], [t('execution.sessions', language), overview.usage.sessions, ''], [t('execution.queued', language), overview.usage.queued, overview.settings.queued]].map(([name, used, limit]) => <div key={name} className="rounded-xl bg-background/60 border border-border/50 p-3 text-text-muted">{name}<strong className="block text-xl text-text-primary mt-1">{used}{limit ? <span className="text-xs font-normal text-text-muted"> / {limit}</span> : null}</strong></div>)}
      </div>
      <nav className="flex gap-2" aria-label={t('execution.sections', language)}>
        {([['running', Activity, t('execution.runningTab', language)], ['history', Archive, t('execution.historyTab', language)], ['settings', Settings2, t('execution.settingsTab', language)]] as const).map(([key, Icon, text]) => <button key={key} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)} className={`${button} flex items-center gap-2 ${tab === key ? 'bg-accent/10 !text-accent border-accent/40' : ''}`}><Icon size={14} />{text}</button>)}
      </nav>
      {error && <p role="alert" className="text-sm text-red-400 break-all">{error}</p>}
      {notice && <p role="status" className="text-sm text-accent">{notice}</p>}
      {!overview && !error && <p className="text-text-muted">{t('execution.loading', language)}</p>}
      {tab === 'settings' ? <div className="space-y-4">
        <p className="text-xs text-text-muted">{t('execution.settingsDescription', language)}</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">{fields.map(([key, labelKey, scale = 1]) => <label key={key} className="text-xs text-text-secondary space-y-1 block">{t(labelKey, language)}<input type="number" className="block w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-text-primary" value={draft[key] / scale} min={EXECUTION_SETTING_RANGES[key][0] / scale} max={EXECUTION_SETTING_RANGES[key][1] / scale} step={scale > 1024 ? 0.25 : 1} onChange={event => { dirty.current = true; setDraft({ ...draft, [key]: Number(event.target.value) * scale }) }} /></label>)}</div>
        <p className="text-xs text-text-muted">{t('execution.recyclingDescription', language)}</p>
        <div className="flex gap-2"><button className={`${button} !text-accent`} disabled={busy} onClick={() => void save()}>{t('execution.save', language)}</button><button className={button} disabled={busy} onClick={() => { dirty.current = true; setDraft(normalizeExecutionSettings(undefined)) }}>{t('execution.defaults', language)}</button></div>
      </div> : <>
        <input aria-label={t('execution.filterLabel', language)} placeholder={t('execution.filterPlaceholder', language)} value={filter} onChange={event => setFilter(event.target.value)} className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm text-text-primary" />
        {tab === 'running' && <p className="text-xs text-text-muted">{t('execution.hostingDescription', language)}</p>}
        <div className="space-y-2">{visible.map(renderJob)}{!visible.length && <p className="p-5 text-center text-text-muted text-sm">{t('execution.empty', language)}</p>}</div>
        {tab === 'running' && overview?.sessions.map(session => <article key={session.id} className="rounded-xl border border-border/60 p-3 space-y-2">
          <p className="text-sm text-text-primary break-all">{session.shell} · {executionStatusLabel(session.state, language)} · {t('execution.window', language)} {session.ownerId}</p><p className="text-xs text-text-muted break-all">{session.cwd}</p>
          <div className="flex flex-wrap gap-2">
            <button className={button} disabled={busy} onClick={() => void act(`session:${session.id}`, 'log', session.shell)}>{t('execution.viewLog', language)}</button>
            <button className={button} disabled={busy || session.state === 'stopping'} onClick={() => void act(session.id, 'stop-session')}>{session.remoteHost ? (t('execution.closeSsh', language)) : (t('execution.stopSession', language))}</button>
            {session.ownerId === overview.ownerId && session.isAgent && !session.userControlled && !session.remoteHost && session.state === 'ready' && <button className={button} disabled={busy} onClick={() => void act(session.id, session.disposable ? 'retain' : 'recycle')}>{session.disposable ? (t('execution.retain', language)) : (t('execution.recycle', language))}</button>}
            {session.disposable && <span className="text-xs text-amber-500 self-center">{t('execution.recycleEligible', language)}</span>}
          </div>
        </article>)}
      </>}
      {log && <section className="rounded-xl border border-border/60 overflow-hidden">
        <div className="flex items-center justify-between gap-3 bg-background/60 p-3"><code className="text-xs truncate text-text-primary">{log.title}</code><div className="flex shrink-0 gap-2"><button className={button} disabled={busy} onClick={() => void act(log.id, 'log', log.title)}>{t('execution.refreshLog', language)}</button><button className={button} onClick={() => setLog(undefined)}>{t('execution.closeLog', language)}</button></div></div>
        {log.truncated && <p className="px-3 py-2 text-xs text-amber-500">{t('execution.tailDescription', language)}</p>}
        <pre className="text-xs text-text-secondary p-3 max-h-72 overflow-auto whitespace-pre-wrap break-all">{log.output || (t('execution.noOutput', language))}</pre>
      </section>}
    </div>
  </Modal>
}
