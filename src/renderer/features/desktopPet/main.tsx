import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { Settings2, Sparkles, X } from 'lucide-react'
import type { PetPerformance, PetReaction, PetViewState } from '@shared/desktopPet'
import { t } from '@shared/i18n'
import { otterAssetSrc, type OtterAssetKey } from '@components/brand/otterAssets'
import { Button } from '@components/ui/Button'
import { getLive2DActions, useLive2D } from './live2d'
import { usePetSpeech } from './usePetSpeech'
import './desktopPet.css'

const otterPoses: Record<string, OtterAssetKey> = {
  cheer: 'waveStand', wave: 'chat', curious: 'sitFront', rest: 'rest',
}

const otterActions = [
  { id: 'cheer', label: 'Jump and celebrate with confetti' },
  { id: 'wave', label: 'Wave a paw' },
  { id: 'curious', label: 'Sit upright and look curious' },
  { id: 'rest', label: 'Curl up for a rest' },
]

const canvasActions = [
  { id: 'bounce', label: 'Give a quick celebratory bounce' },
  { id: 'tilt', label: 'Tilt playfully to one side' },
]

function DesktopPet({ state }: { state: PetViewState }) {
  const { preferences, language, models } = state
  const [line, setLine] = useState<PetPerformance>()
  const [thinking, setThinking] = useState(false)
  const [reactionError, setReactionError] = useState('')
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [attempt, retry] = useState(0)
  const actor = useRef<HTMLDivElement>(null)
  const lineTimer = useRef<number>()
  const pending = useRef(false)
  const pointer = useRef<{ id: number; x: number; y: number; moving: boolean }>()
  const ignoreClick = useRef(false)
  const { speak, reset, speaking, failed } = usePetSpeech()
  useEffect(() => { reset() }, [preferences.character, preferences.voice, reset])
  const selected = models.find(model => model.id === preferences.character)
  const live = useLive2D(container, selected?.id)
  const isNight = preferences.character === 'night-otter'
  const name = preferences.name || selected?.name || (isNight ? t('desktopPet.night', language) : t('desktopPet.otter', language))

  const react = useCallback(async (reaction: PetReaction) => {
    if (pending.current) return
    pending.current = true
    const liveActions = live?.instance ? getLive2DActions(live.instance) : []
    const options = live?.instance ? [...canvasActions, ...liveActions] : otterActions
    setThinking(true)
    setReactionError('')
    try {
      const result = await window.desktopPet.react(reaction, options.map(({ id, label }) => ({ id, label })))
      if (result.status === 'unavailable') setReactionError(t('desktopPet.noModel', language))
      if (result.status === 'error') setReactionError(t('desktopPet.reactionError', language))
      if (result.status !== 'played') return
      const { performance } = result
      setLine(performance)
      window.clearTimeout(lineTimer.current)
      lineTimer.current = window.setTimeout(() => setLine(undefined), 7500)
      liveActions.find(option => option.id === performance.action)?.play()
      if (performance.action && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const pose = performance.action === 'cheer' || performance.action === 'bounce'
          ? 'translateY(-13px) rotate(-5deg)'
          : performance.action === 'wave' || performance.action === 'tilt' ? 'rotate(6deg)' : null
        if (pose) actor.current?.animate([{ transform: 'none' }, { transform: pose }, { transform: 'none' }], {
          duration: 600, easing: 'ease-out',
        })
      }
      void speak(preferences.voice, performance, language)
    } catch {
      setReactionError(t('desktopPet.reactionError', language))
    } finally {
      pending.current = false
      setThinking(false)
    }
  }, [preferences.voice, language, live?.instance, speak])

  useEffect(() => window.desktopPet.onReaction(reaction => { void react(reaction) }), [react])

  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || pointer.current) return
    ignoreClick.current = false
    pointer.current = { id: event.pointerId, x: event.screenX, y: event.screenY, moving: false }
    event.currentTarget.setPointerCapture(event.pointerId)
    window.desktopPet.drag('start')
  }

  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = pointer.current
    if (drag?.id !== event.pointerId) return
    if (!drag.moving && Math.hypot(event.screenX - drag.x, event.screenY - drag.y) < 4) return
    drag.moving = true
    window.desktopPet.drag('move')
  }

  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = pointer.current
    if (drag?.id !== event.pointerId) return
    ignoreClick.current = drag.moving
    pointer.current = undefined
    window.desktopPet.drag('end')
  }

  useEffect(() => () => window.clearTimeout(lineTimer.current), [])
  useEffect(() => {
    if (!live?.instance) return
    const start = performance.now()
    return live.instance.addLipSync({
      driver: {
        isSpeaking: () => speaking,
        getMouthOpen: () => 0.35 + 0.25 * Math.sin((performance.now() - start) / 42),
      },
    })
  }, [live?.instance, speaking])

  return (
    <main className={`pet ${isNight ? 'pet-night' : ''}`}>
      <div className="pet-stage">
        <div className="pet-dialogue-slot" aria-live="polite">
          {failed && <p role="status" className="pet-status">{t('desktopPet.voiceError', language)}</p>}
          {(thinking || reactionError) && <p role="status" className="pet-status">{thinking ? t('desktopPet.thinking', language) : reactionError}</p>}
          {selected && !live?.instance && (
            <div role="status" className="pet-status">
              {live?.failed ? t('desktopPet.modelError', language) : t('desktopPet.modelLoading', language)}
              {live?.failed && <Button type="button" variant="ghost" size="sm" onClick={() => retry(value => value + 1)}>{t('desktopPet.retry', language)}</Button>}
            </div>
          )}
          {line && <p className="pet-dialogue" title={line.text}>{line.text}</p>}
        </div>
        <Button type="button" variant="ghost" className="pet-hit" title={name} aria-label={t('desktopPet.interact', language)}
          aria-description={t('desktopPet.drag', language)}
          onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag}
          onPointerCancel={endDrag} onLostPointerCapture={endDrag}
          onClick={event => { if (event.detail === 0 || !ignoreClick.current) void react('greeting') }}>
          <span className="pet-shadow" aria-hidden="true" />
          <div className="pet-actor" ref={actor}>
            {selected && <div key={`${selected.id}:${attempt}`} className="pet-live" ref={setContainer} />}
            {!live?.instance && <img draggable={false} className="pet-figure" alt="" src={otterAssetSrc(
              (line?.action && otterPoses[line.action]) || (isNight ? 'rest' : 'sitThreeQuarter'),
            )} />}
            {line?.action === 'cheer' && <img draggable={false} className="pet-sparks" alt="" src={otterAssetSrc('emotionConfetti')} />}
          </div>
        </Button>
        <div className="pet-controls">
          <Button type="button" variant="icon" size="icon" className="pet-icon" title={t('desktopPet.preview', language)} aria-label={t('desktopPet.preview', language)} disabled={thinking} onClick={() => void react('preview')}><Sparkles size={15} /></Button>
          <Button type="button" variant="icon" size="icon" className="pet-icon" title={t('desktopPet.settingsTitle', language)} aria-label={t('desktopPet.settingsTitle', language)} onClick={window.desktopPet.openSettings}><Settings2 size={16} /></Button>
          <Button type="button" variant="icon" size="icon" className="pet-icon" title={t('desktopPet.close', language)} aria-label={t('desktopPet.close', language)} onClick={window.desktopPet.close}><X size={15} /></Button>
        </div>
      </div>
    </main>
  )
}

function App() {
  const [state, setState] = useState<PetViewState>()
  useEffect(() => {
    const api = window.desktopPet
    if (!api) return
    const unsubscribe = api.onState(setState)
    void api.getState().then(setState).catch(() => api.close())
    return unsubscribe
  }, [])
  useEffect(() => {
    if (state) document.documentElement.lang = state.language
  }, [state?.language])
  return state ? <DesktopPet state={state} /> : null
}

createRoot(document.getElementById('root')!).render(<App />)
