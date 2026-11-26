import { useCallback, useEffect, useRef, useState } from 'react'
import type { PetLanguage, PetPerformance, PetVoice } from '@shared/desktopPet'
import { toLocaleTag } from '@shared/i18n'

export function usePetSpeech() {
  const generation = useRef(0)
  const playing = useRef<HTMLAudioElement>()
  const [speaking, setSpeaking] = useState(false)
  const [failed, setFailed] = useState(false)

  const stop = useCallback(() => {
    generation.current++
    window.speechSynthesis?.cancel()
    window.desktopPet.stopSpeech()
    if (playing.current) {
      playing.current.pause()
      URL.revokeObjectURL(playing.current.src)
      playing.current = undefined
    }
  }, [])

  useEffect(() => stop, [stop])

  const speak = useCallback(async (voice: PetVoice, performance: PetPerformance, language: PetLanguage) => {
    stop()
    setSpeaking(false)
    setFailed(false)
    if (voice === 'off') return
    const request = generation.current
    const finish = (error = false) => {
      if (request !== generation.current) return
      stop()
      setSpeaking(false)
      setFailed(error)
    }
    try {
      if (voice === 'system') {
        const synthesis = window.speechSynthesis
        if (!synthesis) return finish(true)
        const utterance = new SpeechSynthesisUtterance(performance.text)
        utterance.lang = toLocaleTag(language)
        utterance.voice = synthesis.getVoices().find(voice => voice.localService && voice.lang.startsWith(language)) ?? null
        utterance.onstart = () => { if (request === generation.current) setSpeaking(true) }
        utterance.onend = () => finish()
        utterance.onerror = () => finish(true)
        synthesis.speak(utterance)
        return
      }
      const result = await window.desktopPet.speak(performance.id)
      if (request !== generation.current) return
      if (!result) return finish(true)
      const audio = new Audio(URL.createObjectURL(new Blob([result.data], { type: result.mediaType })))
      playing.current = audio
      audio.onplaying = () => { if (request === generation.current) setSpeaking(true) }
      audio.onended = () => finish()
      audio.onerror = () => finish(true)
      await audio.play()
    } catch {
      finish(true)
    }
  }, [stop])

  const reset = useCallback(() => {
    stop()
    setSpeaking(false)
    setFailed(false)
  }, [stop])

  return { speak, reset, speaking, failed }
}
