import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { ChevronDown, Download, Image, PawPrint, Upload } from 'lucide-react'
import { Button, Input, Select, Switch, Textarea } from '@components/ui'
import { t, type Language } from '@shared/i18n'
import type { PetPlacement, PetPreferences, PetSpeechConfig, PetState } from '@shared/desktopPet'
import { PET_GALLERY, PET_MATERIAL_LICENSE, PET_SAMPLE_TERMS } from '@shared/petGallery'
import { normalizePetSpeech, parsePetSpeechConfig } from '@shared/petSpeechConfig'
import { api } from '@services/electronAPI'

export interface DesktopPetSettingsHandle {
  save(): Promise<boolean>
}

const PLACEMENTS = [
  ['custom', 'desktopPet.customPosition'],
  ['bottom-right', 'desktopPet.bottomRight'],
  ['bottom-left', 'desktopPet.bottomLeft'],
  ['top-right', 'desktopPet.topRight'],
  ['top-left', 'desktopPet.topLeft'],
] as const

const FIELD = 'grid gap-1.5 text-xs font-medium text-text-secondary'
const PANEL = 'space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5'

export const DesktopPetSettings = forwardRef<DesktopPetSettingsHandle, {
  language: Language
  onDirtyChange: (dirty: boolean) => void
}>(function DesktopPetSettings({ language, onDirtyChange }, ref) {
  const latest = useRef<PetState>()
  const [state, setState] = useState<PetState>()
  const [draft, setDraft] = useState<PetPreferences>()
  const [position, setPosition] = useState<{ x: string; y: string }>()
  const [speechKey, setSpeechKey] = useState<string | null>()
  const [showSpeechTemplate, setShowSpeechTemplate] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const dirty = !!draft && (JSON.stringify(draft) !== JSON.stringify(state?.preferences) || speechKey !== undefined
    || (draft.placement === 'custom' && position !== undefined))

  const sync = useCallback((next: PetState) => {
    const old = latest.current
    latest.current = next
    setState(next)
    setDraft(current => !current || JSON.stringify(current) === JSON.stringify(old?.preferences) ? next.preferences : current)
  }, [])

  useEffect(() => {
    const pet = api.desktopPet
    let disposed = false
    const unsubscribe = pet?.onState(sync)
    void pet?.getState().then(next => {
      if (!disposed) sync(next)
    }).catch(() => {
      if (!disposed) setError(t('desktopPet.loadError', language))
    })
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [language, sync])

  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])

  const edit = <K extends keyof PetPreferences>(key: K, value: PetPreferences[K]) =>
    setDraft(previous => previous && { ...previous, [key]: value })
  const editSpeech = (key: keyof PetSpeechConfig, value: string) =>
    setDraft(previous => previous && { ...previous, speech: { ...previous.speech, [key]: value } })

  const save = async () => {
    if (!state || !draft || busy) return false
    const coordinates = position && draft.placement === 'custom'
      ? { x: Number(position.x), y: Number(position.y) }
      : undefined
    if (coordinates && (!position?.x.trim() || !position.y.trim() || !Number.isFinite(coordinates.x) || !Number.isFinite(coordinates.y))) {
      setError(t('desktopPet.positionError', language))
      return false
    }
    if (draft.voice === 'custom') {
      try {
        parsePetSpeechConfig(normalizePetSpeech(draft.speech))
      } catch {
        setError(t('desktopPet.speechInvalid', language))
        setShowSpeechTemplate(true)
        return false
      }
    }
    setBusy('save')
    setError('')
    try {
      const next = await api.desktopPet.savePreferences(draft, coordinates, speechKey)
      sync(next)
      setDraft(next.preferences)
      setPosition(undefined)
      setSpeechKey(undefined)
      return true
    } catch {
      setError(t('desktopPet.saveError', language))
      return false
    } finally {
      setBusy('')
    }
  }
  useImperativeHandle(ref, () => ({ save }))

  const changeLibrary = async (key: string, action: () => Promise<PetState>, errorKey: 'desktopPet.importError' | 'desktopPet.downloadError' | 'desktopPet.saveError') => {
    setBusy(key)
    setError('')
    try {
      const next = await action()
      sync(next)
      if (key !== 'import' || state?.preferences.character !== next.preferences.character) edit('character', next.preferences.character)
    } catch {
      setError(t(errorKey, language))
    } finally {
      setBusy('')
    }
  }

  if (!state || !draft) return <p role="status" className="text-sm text-text-muted">{error || t('desktopPet.saving', language)}</p>

  const toggleWindow = async () => {
    try {
      if (state.visible) await api.desktopPet.close()
      else await api.desktopPet.open()
    } catch {
      setError(t('desktopPet.loadError', language))
    }
  }

  const currentPosition = position ?? { x: String(state.position?.x ?? 0), y: String(state.position?.y ?? 0) }
  const selectedModel = state.models.find(model => model.id === draft.character)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-surface/25 p-4">
        <p className="text-xs text-text-muted">{state.model ? `${t('desktopPet.modelPrefix', language)} · ${state.model}` : t('desktopPet.noModel', language)}</p>
        <Button variant={state.visible ? 'secondary' : 'primary'} size="sm" onClick={() => void toggleWindow()}>
          <PawPrint className="mr-1.5 h-4 w-4" />
          {t(state.visible ? 'desktopPet.close' : 'desktopPet.open', language)}
        </Button>
      </div>
      <fieldset disabled={!!busy} className={PANEL}>
        <h4 className="text-sm font-semibold text-text-primary">{t('desktopPet.character', language)}</h4>
        <div className="flex flex-wrap items-end gap-2">
          <label className={`${FIELD} min-w-40 flex-1`}>
            {t('desktopPet.currentCharacter', language)}
            <Select aria-label={t('desktopPet.currentCharacter', language)} value={draft.character} onChange={value => edit('character', value)}
              options={[
                { value: 'otter', label: t('desktopPet.otter', language) },
                { value: 'night-otter', label: t('desktopPet.night', language) },
                ...state.models.map(model => ({ value: model.id, label: model.name })),
              ]} />
          </label>
          <Button variant="secondary" size="sm" onClick={() => void changeLibrary('import', api.desktopPet.importModel, 'desktopPet.importError')}>
            <Upload className="mr-1.5 h-4 w-4" />{t('desktopPet.importModel', language)}
          </Button>
          {selectedModel && <Button variant="ghost" size="sm" onClick={() => void changeLibrary('remove', () => api.desktopPet.removeModel(selectedModel.id), 'desktopPet.saveError')}>
            {t('desktopPet.removeModel', language)}
          </Button>}
        </div>
        <p className="text-xs text-text-muted">{t('desktopPet.importHelp', language)}</p>
        <div className="space-y-3 border-t border-border/60 pt-4">
          <h5 className="text-xs font-semibold text-text-primary">{t('desktopPet.freeGallery', language)}</h5>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {PET_GALLERY.map(model => {
              const installed = state.models.find(item => item.galleryId === model.id)
              const active = !!installed && draft.character === installed.id
              return (
                <div key={model.id} className={`overflow-hidden rounded-xl border bg-surface/70 ${active ? 'border-accent' : 'border-border/70'}`}>
                  <div className="relative aspect-[16/10] overflow-hidden bg-surface flex items-center justify-center">
                    <Image className="h-5 w-5 text-text-muted" aria-hidden="true" />
                    <img className="absolute inset-0 h-full w-full object-cover" src={`https://www.live2d.com/wp-content/uploads/2026/06/${model.image}`}
                      alt="" loading="lazy" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true }} />
                  </div>
                  <div className="space-y-2 p-3">
                    <a className="block truncate text-sm font-semibold text-text-primary hover:text-accent" title={model.name}
                      href={`https://www.live2d.com/en/learn/sample/${model.page}/`} target="_blank" rel="noreferrer">{model.name}</a>
                    <Button variant={active ? 'ghost' : 'secondary'} size="sm" className="w-full justify-center"
                      disabled={active || !!busy} onClick={() => {
                        if (installed) edit('character', installed.id)
                        else void changeLibrary(model.id, () => api.desktopPet.installGalleryModel(model.id), 'desktopPet.downloadError')
                      }}>
                      {!installed && <Download className="mr-1.5 h-3.5 w-3.5" />}
                      {t(busy === model.id ? 'desktopPet.downloading' : active ? 'desktopPet.selected' : installed ? 'desktopPet.selectModel' : 'desktopPet.downloadModel', language)}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
          <p className="text-xs leading-relaxed text-text-muted">
            {t('desktopPet.galleryCredit', language)}{' '}
            <a className="text-accent hover:underline" href={PET_MATERIAL_LICENSE} target="_blank" rel="noreferrer">{t('desktopPet.galleryLicense', language)}</a>
            {' · '}
            <a className="text-accent hover:underline" href={PET_SAMPLE_TERMS} target="_blank" rel="noreferrer">{t('desktopPet.galleryTerms', language)}</a>
          </p>
        </div>
      </fieldset>
      <fieldset disabled={!!busy} className={PANEL}>
        <h4 className="text-sm font-semibold text-text-primary">{t('desktopPet.appearance', language)}</h4>
        <label className={FIELD}>
          <span className="flex justify-between">{t('desktopPet.scale', language)} <span>{draft.scale}%</span></span>
          <Input type="range" aria-label={t('desktopPet.scale', language)} min={70} max={150} step={5} value={draft.scale} className="accent-accent cursor-pointer"
            onChange={event => edit('scale', event.target.valueAsNumber)} />
        </label>
        <label className={FIELD}>
          {t('desktopPet.placement', language)}
          <Select aria-label={t('desktopPet.placement', language)} value={draft.placement}
            onChange={value => edit('placement', value as PetPlacement)}
            options={PLACEMENTS.map(([value, key]) => ({ value, label: t(key, language) }))} />
        </label>
        {draft.placement === 'custom' && <div className="grid grid-cols-2 gap-3">
          <label className={FIELD}>{t('desktopPet.positionX', language)}
            <Input type="number" value={currentPosition.x} onChange={event => setPosition({ ...currentPosition, x: event.target.value })} />
          </label>
          <label className={FIELD}>{t('desktopPet.positionY', language)}
            <Input type="number" value={currentPosition.y} onChange={event => setPosition({ ...currentPosition, y: event.target.value })} />
          </label>
        </div>}
        <div className="flex items-center justify-between text-xs text-text-secondary">
          {t('desktopPet.onTop', language)}
          <Switch aria-label={t('desktopPet.onTop', language)} checked={draft.alwaysOnTop} onChange={event => edit('alwaysOnTop', event.target.checked)} />
        </div>
        <div className="flex items-center justify-between text-xs text-text-secondary">
          {t('desktopPet.startup', language)}
          <Switch aria-label={t('desktopPet.startup', language)} checked={draft.openOnStartup} onChange={event => edit('openOnStartup', event.target.checked)} />
        </div>
      </fieldset>
      <fieldset disabled={!!busy} className={PANEL}>
        <h4 className="text-sm font-semibold text-text-primary">{t('desktopPet.interactionSettings', language)}</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={FIELD}>{t('desktopPet.name', language)}
            <Input value={draft.name} maxLength={32} onChange={event => edit('name', event.target.value)} />
          </label>
          <label className={FIELD}>{t('desktopPet.address', language)}
            <Input value={draft.salutation} maxLength={24} onChange={event => edit('salutation', event.target.value)} />
          </label>
          <label className={FIELD}>
            {t('desktopPet.personality', language)}
            <Select aria-label={t('desktopPet.personality', language)} value={draft.personality}
              onChange={value => edit('personality', value === 'calm' ? 'calm' : 'playful')}
              options={[
                { value: 'playful', label: t('desktopPet.playful', language) },
                { value: 'calm', label: t('desktopPet.calm', language) },
              ]} />
          </label>
          <label className={FIELD}>
            {t('desktopPet.voice', language)}
            <Select aria-label={t('desktopPet.voice', language)} value={draft.voice}
              onChange={value => edit('voice', value as PetPreferences['voice'])}
              options={[
                { value: 'off', label: t('desktopPet.mute', language) },
                { value: 'system', label: t('desktopPet.systemVoice', language) },
                { value: 'custom', label: t('desktopPet.customVoice', language) },
              ]} />
          </label>
        </div>
        {draft.voice === 'custom' && (
          <div className="space-y-3 rounded-xl border border-border/60 bg-background/30 p-4">
            <label className={FIELD}>{t('desktopPet.speechEndpoint', language)}
              <Input type="url" placeholder="https://tts.example.com/speech" value={draft.speech.endpoint} maxLength={2048}
                onChange={event => editSpeech('endpoint', event.target.value)} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={FIELD}>{t('desktopPet.speechModel', language)}
                <Input value={draft.speech.model} maxLength={128} onChange={event => editSpeech('model', event.target.value)} />
              </label>
              <label className={FIELD}>{t('desktopPet.speechVoice', language)}
                <Input value={draft.speech.voice} maxLength={128} onChange={event => editSpeech('voice', event.target.value)} />
              </label>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className={`${FIELD} min-w-44 flex-1`}>{t('desktopPet.speechKey', language)}
                <Input type="password" autoComplete="new-password" value={speechKey ?? ''} maxLength={4096}
                  placeholder={t(speechKey === null ? 'desktopPet.speechKeyCleared' : state.speechKeyConfigured ? 'desktopPet.speechKeySaved' : 'desktopPet.speechKeyOptional', language)}
                  onChange={event => setSpeechKey(event.target.value || undefined)} />
              </label>
              {state.speechKeyConfigured && speechKey !== null && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setSpeechKey(null)}>
                  {t('desktopPet.clearSpeechKey', language)}
                </Button>
              )}
            </div>
            <Button type="button" variant="ghost" size="sm" aria-expanded={showSpeechTemplate}
              rightIcon={<ChevronDown className={`size-4 ${showSpeechTemplate ? 'rotate-180' : ''}`} />}
              onClick={() => setShowSpeechTemplate(value => !value)}>
              {t('desktopPet.speechRequest', language)}
            </Button>
            {showSpeechTemplate && <div className="space-y-3">
              <p className="text-xs text-text-muted">{t('desktopPet.speechTemplateHelp', language)}</p>
              <label className={FIELD}>{t('desktopPet.speechHeaders', language)}
                <Textarea rows={3} spellCheck={false} className="font-mono" value={draft.speech.headers} maxLength={8192}
                  onChange={event => editSpeech('headers', event.target.value)} />
              </label>
              <label className={FIELD}>{t('desktopPet.speechBody', language)}
                <Textarea rows={5} spellCheck={false} className="font-mono" value={draft.speech.body} maxLength={8192}
                  onChange={event => editSpeech('body', event.target.value)} />
              </label>
              <label className={FIELD}>{t('desktopPet.speechAudioField', language)}
                <Input placeholder="audioContent" value={draft.speech.audioField} maxLength={140}
                  onChange={event => editSpeech('audioField', event.target.value)} />
                <span className="text-text-muted">{t('desktopPet.speechAudioFieldHelp', language)}</span>
              </label>
            </div>}
          </div>
        )}
        <label className={FIELD}>
          {t('desktopPet.direction', language)}
          <Textarea rows={3} maxLength={280} value={draft.characterPrompt}
            placeholder={t('desktopPet.directionHint', language)} onChange={event => edit('characterPrompt', event.target.value)} />
        </label>
        <div>
          <div className="flex items-center justify-between text-xs text-text-secondary">
            {t('desktopPet.activity', language)}
            <Switch aria-label={t('desktopPet.activity', language)} checked={draft.reactToActivity} onChange={event => edit('reactToActivity', event.target.checked)} />
          </div>
          <p className="mt-1 text-xs text-text-muted">{t('desktopPet.activityHelp', language)}</p>
        </div>
      </fieldset>
      {busy && <p role="status" className="text-xs text-text-muted">{t('desktopPet.saving', language)}</p>}
      {error && <p role="alert" className="sticky bottom-1 rounded-lg border border-red-500/30 bg-surface p-3 text-xs text-status-error">{error}</p>}
    </div>
  )
})
