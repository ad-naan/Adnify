import { t, type Language } from '@shared/i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Download, Upload, FolderOpen, Play, WandSparkles, Settings2, HardDrive, ChevronRight, ArrowLeft, Loader2 } from 'lucide-react'
import { Button, Input, Modal, Switch } from '@components/ui'
import { useStore } from '@store'
import { generateAssetConfiguration, redactAssetExample } from '@services/assetConfigAssistant'
import { assetService } from '@services/assetService'
import { assetConfigurationPreference } from '@/renderer/settings/assetConfigurationPreference'
import { assetToolProvider } from '@/renderer/agent/tools/providers/AssetToolProvider'
import { compileInputs, parseCapability } from '@shared/assets/capability'
import type { AssetCapability, AssetInputSchema, AssetJobSummary, AssetSnapshot } from '@shared/types/assets'
import { assetKindKeys } from '@components/agent/AssetJobCard'
import AssetHistory from './AssetHistory'

const sectionClass = 'space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5'
const textAreaClass = 'w-full rounded-xl border border-border bg-surface/50 p-3 text-sm text-text-primary placeholder:text-text-muted/70 focus:outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/10 disabled:opacity-50'

function blankCapability(language: Language): AssetCapability {
  return {
    id: 'my_image', revision: 1, name: t('assets.defaultToolName', language), description: t('assets.defaultToolDescription', language), enabled: true, kind: 'image',
    inputSchema: { type: 'object', properties: { prompt: { type: 'string', description: t('assets.promptDescription', language) } }, required: ['prompt'], additionalProperties: false },
    request: { url: '', body: { prompt: { $input: '/prompt' } } },
    output: { itemsPath: '/images', urlPath: '/url', mimeType: 'image/png', allowedOrigins: [], maxFileMB: 20 },
  }
}
function initialInputs(schema: AssetInputSchema): Record<string, unknown> {
  return Object.fromEntries(Object.entries(schema.properties || {}).filter(([key, value]) => value.default !== undefined || schema.required?.includes(key)).map(([key, value]) => [key, value.default ?? (value.type === 'boolean' ? false : value.type === 'number' || value.type === 'integer' ? value.minimum || 0 : value.type === 'object' ? {} : value.type === 'array' ? [] : '')]))
}
function InputField({ name, schema, value, onChange }: { name: string; schema: AssetInputSchema; value: unknown; onChange: (value: unknown) => void }) {
  if (schema.enum) return <select aria-label={name} className={textAreaClass} value={String(value ?? '')} onChange={e => onChange(e.target.value)}><option value="">—</option>{schema.enum.map(v => <option key={v}>{v}</option>)}</select>
  if (schema.type === 'boolean') return <Switch aria-label={name} checked={!!value} onChange={e => onChange(e.target.checked)} />
  if (schema.type === 'object' || schema.type === 'array') return <JsonField name={name} value={value} onChange={onChange} />
  return <Input aria-label={name} type={schema.type === 'number' || schema.type === 'integer' ? 'number' : 'text'} min={schema.minimum} max={schema.maximum} step={schema.type === 'integer' ? 1 : 'any'} value={String(value ?? '')} onChange={e => onChange(schema.type === 'number' || schema.type === 'integer' ? Number(e.target.value) : e.target.value)} />
}
function JsonField({ name, value, onChange }: { name: string; value: unknown; onChange: (value: unknown) => void }) {
  const language = useStore(state => state.language)
  const [text, setText] = useState(JSON.stringify(value, null, 2))
  const [invalid, setInvalid] = useState(false)
  return <div><textarea aria-label={name} aria-invalid={invalid} className={`${textAreaClass} font-mono`} value={text} onChange={e => {
    setText(e.target.value)
    try { onChange(JSON.parse(e.target.value)); setInvalid(false) } catch { onChange(undefined); setInvalid(true) }
  }} />{invalid && <span className="text-status-error text-xs">{t('assets.invalidJson', language)}</span>}</div>
}

export default function AssetSettings({ language }: { language: Language }) {
  const [snapshot, setSnapshot] = useState<AssetSnapshot>()
  const [draft, setDraft] = useState<string>()
  const [savedCapability, setSavedCapability] = useState<AssetCapability>()
  const [secret, setSecret] = useState('')
  const [inputs, setInputs] = useState<Record<string, unknown>>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<'example' | 'config' | 'test' | 'storage' | null>(null)
  const [example, setExample] = useState('')
  const [assistantNotes, setAssistantNotes] = useState<string[]>([])
  const [advanced, setAdvanced] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const llmConfig = useStore(state => state.llmConfig)
  const fileInput = useRef<HTMLInputElement>(null)
  const load = useCallback(async () => setSnapshot(await assetService.request<AssetSnapshot>({ type: 'snapshot' })), [])
  useEffect(() => { void load().catch(e => setError(e.message)) }, [load])
  useEffect(() => {
    const unsubscribe = assetConfigurationPreference.subscribe(() => { void load().catch(e => setError(e.message)) })
    void assetConfigurationPreference.hydrate().catch(e => setError(e.message))
    return unsubscribe
  }, [load])
  const action = async (fn: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('')
    try { await fn() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const open = (view: typeof dialog) => { setError(''); setNotice(''); setDialog(view) }
  const close = () => { if (!busy) { setDialog(null); setError(''); setSecret('') } }
  const edit = (capability: AssetCapability) => {
    setDraft(JSON.stringify(capability, null, 2)); setSavedCapability(capability); setSecret(''); setInputs(initialInputs(capability.inputSchema)); setAdvanced(false)
  }
  let preview: AssetCapability | undefined
  try { if (draft) { const value = JSON.parse(draft); if (value && typeof value === 'object') preview = value } } catch { /* The JSON editor remains usable while incomplete. */ }
  const update = (value: Partial<AssetCapability>) => { if (preview) setDraft(JSON.stringify({ ...preview, ...value }, null, 2)) }
  const generate = () => action(async () => {
    setAssistantNotes([])
    const redacted = redactAssetExample(example)
    setExample(redacted)
    const result = await generateAssetConfiguration(redacted, llmConfig, language)
    setAssistantNotes(result.notes)
    if (result.capability) {
      let id = result.capability.id
      let suffix = 2
      while (snapshot?.capabilities.some(cap => cap.id === id)) id = `${result.capability.id.slice(0, 34)}_${suffix++}`
      edit({ ...result.capability, id }); setSavedCapability(undefined); setDialog('config')
    }
  })
  const save = () => action(async () => {
    const capability = parseCapability(JSON.parse(draft!))
    const saved = await assetService.request<AssetCapability>({ type: 'saveCapability', capability, secret: secret || undefined })
    edit(saved); await load(); await assetToolProvider.refresh(); setDialog(null)
    setNotice(t('assets.savedTheToolLoadsOnTheNext', language))
  })
  const exportConfig = () => action(async () => {
    const cap = parseCapability(JSON.parse(draft!))
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...cap, revision: 1 }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = `${cap.id}.json`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
  const run = () => action(async () => {
    if (!savedCapability) return
    const values = compileInputs(savedCapability.inputSchema).parse(inputs) as Record<string, unknown>
    const job = await assetService.request<AssetJobSummary>({ type: 'submit', capabilityId: savedCapability.id, revision: savedCapability.revision, inputs: values, toolCallId: crypto.randomUUID() })
    await load(); setDialog(null); setHistoryOpen(true); setNotice(`${t('assets.jobSubmitted', language)}: ${job.id}`)
  })
  const storageAction = (type: 'chooseStorage' | 'resetStorage', scope: 'global' | 'project') => action(async () => {
    await assetService.request({ type, scope }); await load()
  })
  const source = snapshot?.storage.projectRoots[snapshot.workspace] ? t('assets.projectOverride', language) : snapshot?.storage.customRoot ? t('assets.globalOverride', language) : t('assets.default', language)
  const feedback = <>{error && <p role="alert" className="rounded-lg bg-status-error/10 px-3 py-2 text-xs text-status-error whitespace-pre-wrap">{error}</p>}{notice && <p role="status" className="text-xs text-accent">{notice}</p>}</>

  return <div className="space-y-5 pb-10">
    {!dialog && feedback}
    <section className={sectionClass}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2"><WandSparkles className="h-5 w-5 text-accent" /><h3 className="text-sm font-medium text-text-primary">{t('assets.generationTools', language)}</h3></div>
        <Button size="sm" onClick={() => { setAssistantNotes([]); open('example') }} disabled={busy} leftIcon={<Plus size={14} />}>{t('assets.addTool', language)}</Button>
      </div>
      {snapshot?.capabilities.length ? <div className="divide-y divide-border/60">
        {snapshot.capabilities.map(cap => <div key={cap.id} className="flex items-center gap-4 py-3">
          <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-sm font-medium text-text-primary truncate">{cap.name}</span><span className="text-xs text-text-muted shrink-0">{t(assetKindKeys[cap.kind], language)}</span></div><p className="mt-1 truncate text-xs text-text-muted" title={cap.request.url}>{cap.request.url}</p></div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="sm" disabled={busy || !cap.enabled} title={t('assets.inputsAndTestRun', language)} onClick={() => { edit(cap); open('test') }}><Play size={14} />{t('assets.testTool', language)}</Button>
            <Button variant="icon" size="sm" disabled={busy} title={t('assets.editTool', language)} aria-label={t('assets.editTool', language)} onClick={() => { edit(cap); setAssistantNotes([]); open('config') }}><Settings2 size={15} /></Button>
            <Switch aria-label={cap.name} checked={cap.enabled} disabled={busy} onChange={() => void action(async () => { await assetService.request({ type: 'saveCapability', capability: { ...cap, enabled: !cap.enabled } }); await load(); await assetToolProvider.refresh() })} />
          </div>
        </div>)}
      </div> : <div className="py-6 text-center space-y-2"><p className="text-sm text-text-secondary">{t('assets.noToolsYet', language)}</p><p className="text-xs leading-5 text-text-muted">{t('assets.setupShortHint', language)}</p></div>}
      {!snapshot && !error && <Loader2 className="h-4 w-4 animate-spin text-text-muted" />}
    </section>

    <section className={sectionClass}>
      <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><HardDrive className="h-5 w-5 text-accent" /><h3 className="text-sm font-medium text-text-primary">{t('assets.assetStorage', language)}</h3></div><span className="text-xs text-text-muted">{source}</span></div>
      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/25 px-3 py-2.5"><FolderOpen size={15} className="shrink-0 text-text-muted" /><span className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary select-all" title={snapshot?.effectiveRoot}>{snapshot?.effectiveRoot || '…'}</span><Button variant="icon" size="sm" title={t('assets.openFolder', language)} aria-label={t('assets.openFolder', language)} onClick={() => void action(async () => { await assetService.request({ type: 'openStorage' }) })}><ChevronRight size={15} /></Button></div>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs leading-5 text-text-muted">{t('assets.storageShortHint', language)}</p><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={busy || !snapshot?.workspace} onClick={() => void action(async () => { await assetService.request({ type: 'useProjectStorage' }); await load() })}>{t('assets.useCurrentProjectFolder', language)}</Button><Button variant="ghost" size="sm" onClick={() => open('storage')}>{t('assets.changeLocation', language)}</Button></div></div>
    </section>

    <details className={sectionClass} open={historyOpen} onToggle={event => setHistoryOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-sm font-medium text-text-primary">{t('assets.referenceAssetsAndRecentJobs', language)}</summary>
      {historyOpen && <AssetHistory language={language} />}
    </details>

    <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''
      if (file) void action(async () => { if (file.size > 100_000) throw new Error(t('assets.configTooLarge', language)); edit(parseCapability(JSON.parse(await file.text()))); setSavedCapability(undefined); setAssistantNotes([]); setDialog('config') })
    }} />

    <Modal isOpen={dialog !== null} onClose={close} size={dialog === 'storage' ? 'lg' : '2xl'} title={dialog === 'example' ? t('assets.addTool', language) : dialog === 'storage' ? t('assets.assetStorage', language) : dialog === 'test' ? t('assets.inputsAndTestRun', language) : t('assets.editTool', language)} noPadding>
      <div className="p-6 space-y-5 max-h-[65vh] overflow-y-auto custom-scrollbar">
        {feedback}
        {dialog === 'example' && <>
          <div className="space-y-2"><h4 className="text-sm font-medium text-text-primary">{t('assets.pasteExamplesAndLetAIFillIn', language)}</h4><p className="text-xs leading-5 text-text-muted">{t('assets.setupExampleHint', language)}</p></div>
          <textarea aria-label={t('assets.requestAndResponseExamples', language)} maxLength={30000} spellCheck={false} disabled={busy} className={`${textAreaClass} h-56 resize-y font-mono text-xs leading-5`} value={example} onChange={e => setExample(e.target.value)} placeholder={t('assets.pasteCurlAnHTTPRequestOrAPI', language)} />
          <div className="flex items-start gap-2 text-xs text-text-muted"><WandSparkles size={14} className="mt-0.5 shrink-0" /><p className="leading-5">{t('assets.assistantModelShort', language, { model: llmConfig.model || t('assets.notSelected', language) })}</p></div>
          {assistantNotes.length > 0 && <div role="status" className="rounded-lg bg-surface/50 p-3 text-xs leading-5 space-y-1">{assistantNotes.map((note, i) => <p key={i}>{note}</p>)}</div>}
          <div className="flex gap-2 border-t border-border/60 pt-3"><Button variant="ghost" size="sm" disabled={busy} onClick={() => { edit(blankCapability(language)); setSavedCapability(undefined); setAssistantNotes([]); setAdvanced(true); setDialog('config') }}>{t('assets.manualSetup', language)}</Button><Button variant="ghost" size="sm" disabled={busy} leftIcon={<Upload size={13} />} onClick={() => fileInput.current?.click()}>{t('assets.importConfig', language)}</Button></div>
        </>}

        {dialog === 'config' && <>
          {preview && <>
            <label className="block space-y-2"><span className="text-xs font-medium text-text-secondary">{t('assets.toolName', language)}</span><Input disabled={busy} value={preview.name || ''} onChange={e => update({ name: e.target.value })} /></label>
            <label className="block space-y-2"><span className="text-xs font-medium text-text-secondary">{t('assets.purposeHelpsTheAgentChooseThisTool', language)}</span><Input disabled={busy} value={preview.description || ''} onChange={e => update({ description: e.target.value })} /></label>
            <label className="block space-y-2"><span className="text-xs font-medium text-text-secondary">{t('assets.endpoint', language)}</span><Input disabled={busy} className="font-mono text-xs" value={preview.request?.url || ''} onChange={e => update({ request: { ...preview.request, url: e.target.value } })} /></label>
            <div className="grid grid-cols-2 gap-4">
              <label className="block space-y-2"><span className="text-xs font-medium text-text-secondary">{t('assets.outputType', language)}</span><select className={textAreaClass} disabled={busy} value={preview.kind} onChange={e => update({ kind: e.target.value as AssetCapability['kind'] })}>{Object.entries(assetKindKeys).map(([kind, key]) => <option key={kind} value={kind}>{t(key, language)}</option>)}</select></label>
              <label className="block space-y-2"><span className="text-xs font-medium text-text-secondary">{t('assets.timeoutSeconds', language)}</span><Input disabled={busy} type="number" min={1} max={600} value={preview.request?.timeoutSeconds ?? 60} onChange={e => update({ request: { ...preview.request, timeoutSeconds: Number(e.target.value) } })} /></label>
            </div>
            {preview.auth && <label className="block space-y-2"><span className="text-xs font-medium text-text-secondary">{t('assets.credentialForHeader', language, { header: preview.auth.header })}</span><Input disabled={busy} type="password" autoComplete="new-password" value={secret} onChange={e => setSecret(e.target.value)} placeholder={savedCapability && snapshot?.credentials.includes(savedCapability.id) ? t('assets.configured', language) : ''} /><p className="text-xs text-text-muted">{t('assets.credentialHint', language)}</p></label>}
          </>}
          {assistantNotes.length > 0 && <details className="text-xs text-text-muted"><summary className="cursor-pointer">{t('assets.assistantNotes', language)}</summary><div className="mt-2 space-y-1 leading-5">{assistantNotes.map((note, i) => <p key={i}>{note}</p>)}</div></details>}
          <div className="border-t border-border/60 pt-3 space-y-3"><button className="flex w-full items-center justify-between text-xs text-text-muted hover:text-text-primary" aria-expanded={advanced} onClick={() => setAdvanced(v => !v)}>{t('assets.advancedConfigurationJSON', language)}<ChevronRight size={14} className={advanced ? 'rotate-90' : ''} /></button>
            {advanced && <><p className="text-xs text-text-muted leading-5">{t('assets.configureParametersRequestsAndOutputMappingsInput', language)}</p><textarea aria-label={t('assets.capabilityJSON', language)} disabled={busy} spellCheck={false} className={`${textAreaClass} h-64 font-mono text-xs leading-5`} value={draft || ''} onChange={e => setDraft(e.target.value)} /><div className="flex gap-2"><Button variant="ghost" size="sm" disabled={busy} onClick={() => void action(async () => { parseCapability(JSON.parse(draft!)); setNotice(t('assets.configurationValidNoAPIRequestWasSent', language)) })}>{t('assets.validateOffline', language)}</Button><Button variant="ghost" size="sm" disabled={busy} leftIcon={<Download size={13} />} onClick={() => void exportConfig()}>{t('assets.exportConfig', language)}</Button></div></>}
          </div>
        </>}

        {dialog === 'test' && savedCapability && <>
          <p className="text-sm font-medium text-text-primary">{savedCapability.name}</p>
          {Object.entries(savedCapability.inputSchema.properties || {}).map(([name, schema]) => <label key={`${savedCapability.id}-${name}`} className="block space-y-2"><span className="text-xs text-text-secondary">{schema.description || name}{savedCapability.inputSchema.required?.includes(name) ? ' *' : ''}</span><InputField name={name} schema={schema} value={inputs[name]} onChange={value => setInputs(prev => ({ ...prev, [name]: value }))} /></label>)}
          <p className="text-xs leading-5 text-text-muted">{t('assets.testingSubmitsARealRequestToYour', language)}</p>
        </>}

        {dialog === 'storage' && <>
          <p className="text-xs leading-5 text-text-muted">{t('assets.storageDialogHint', language)}</p>
          <div className="space-y-4 divide-y divide-border/60">
            <div className="space-y-2"><span className="text-sm text-text-primary">{t('assets.globalOverride', language)}</span><p className="font-mono text-xs text-text-muted break-all">{snapshot?.storage.customRoot || snapshot?.storage.defaultRoot}</p><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={busy} onClick={() => void storageAction('chooseStorage', 'global')}>{t('assets.changeLocation', language)}</Button><Button variant="ghost" size="sm" disabled={busy || !snapshot?.storage.customRoot} onClick={() => void storageAction('resetStorage', 'global')}>{t('assets.resetGlobal', language)}</Button></div></div>
            <div className="space-y-2 pt-4"><span className="text-sm text-text-primary">{t('assets.projectOverride', language)}</span><p className="font-mono text-xs text-text-muted break-all">{snapshot?.storage.projectRoots[snapshot.workspace] || t('assets.inheritGlobal', language)}</p><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={busy || !snapshot?.workspace} onClick={() => void storageAction('chooseStorage', 'project')}>{t('assets.changeLocation', language)}</Button><Button variant="ghost" size="sm" disabled={busy || !snapshot?.storage.projectRoots[snapshot.workspace]} onClick={() => void storageAction('resetStorage', 'project')}>{t('assets.inheritGlobal', language)}</Button></div></div>
          </div>
        </>}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border/60 px-6 py-4">
        <div>{dialog === 'config' && !savedCapability && <Button variant="ghost" size="sm" disabled={busy} leftIcon={<ArrowLeft size={13} />} onClick={() => open('example')}>{t('assets.backToExample', language)}</Button>}</div>
        <div className="flex gap-2"><Button variant="ghost" size="sm" disabled={busy} onClick={close}>{t('cancel', language)}</Button>
          {dialog === 'example' && <Button size="sm" isLoading={busy} disabled={!example.trim()} onClick={() => void generate()}>{t('assets.generateDraft', language)}</Button>}
          {dialog === 'config' && <Button size="sm" isLoading={busy} disabled={!draft} onClick={() => void save()}>{t('assets.saveTool', language)}</Button>}
          {dialog === 'test' && <Button size="sm" isLoading={busy} disabled={!savedCapability?.enabled} onClick={() => void run()}>{t('assets.submitTestGeneration', language)}</Button>}
        </div>
      </div>
    </Modal>
  </div>
}
