import { useEffect, useState } from 'react'
import type { Live2DInstance } from 'live2d-web'
import { PET_MODEL_ENTRY, type PetAction } from '@shared/desktopPet'

let loadingCore: Promise<void> | undefined

function loadCore(url: string): Promise<void> {
  loadingCore ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = url
    script.crossOrigin = 'anonymous'
    script.integrity = 'sha384-KshektsgDLeJaInLQF891mST1tYYMpWEuzK4rQ6eYpwBwPohR3CjQEO855CYGgh6'
    const timer = window.setTimeout(() => fail(), 8000)
    const fail = () => {
      window.clearTimeout(timer)
      script.remove()
      reject(new Error('Cubism Core could not be loaded'))
    }
    script.onload = () => {
      window.clearTimeout(timer)
      resolve()
    }
    script.onerror = fail
    document.head.append(script)
  }).catch(error => {
    loadingCore = undefined
    throw error
  })
  return loadingCore
}

export function useLive2D(container: HTMLDivElement | null, id: string | undefined) {
  const [result, setResult] = useState<{ container: HTMLDivElement; instance?: Live2DInstance; failed?: boolean }>()
  useEffect(() => {
    if (!container || !id) return
    const controller = new AbortController()
    let instance: Live2DInstance | undefined
    void (async () => {
      const { createLive2D, OFFICIAL_CUBISM_CORE_URL } = await import('live2d-web')
      await loadCore(OFFICIAL_CUBISM_CORE_URL)
      controller.signal.throwIfAborted()
      instance = await createLive2D({
        container,
        src: PET_MODEL_ENTRY,
        signal: controller.signal,
        followPointer: true,
        maxFps: 30,
        fit: 'full',
        retries: 0,
        resolveAsset: async path => {
          const data = await window.desktopPet.readAsset(id, path)
          return data && (/\.png$/i.test(path) ? new Blob([data], { type: 'image/png' }) : data)
        },
        onError: () => {
          if (!controller.signal.aborted) setResult({ container, failed: true })
        },
      })
      if (controller.signal.aborted) instance.dispose()
      else setResult({ container, instance })
    })().catch(() => {
      if (!controller.signal.aborted) setResult({ container, failed: true })
    })
    return () => {
      controller.abort()
      instance?.dispose()
      container.replaceChildren()
    }
  }, [container, id])
  return id && result?.container === container ? result : undefined
}

export function getLive2DActions(instance: Live2DInstance): (PetAction & { play: () => void })[] {
  const info = instance.getModelInfo()
  const motions = Object.keys(info.motions).filter(group => info.motions[group] > 0)
  return [
    ...motions.slice(0, 24).map((group, index) => ({
      id: `motion-${index}`,
      label: `Live2D motion group: ${group}`.slice(0, 100),
      play: () => {
        void instance.motion(group, 0, { priority: 'force' }).catch(() => {})
      },
    })),
    ...info.expressions.slice(0, 10).map((expression, index) => ({
      id: `expression-${index}`,
      label: `Live2D expression: ${expression}`.slice(0, 100),
      play: () => { void instance.expression(expression).catch(() => {}) },
    })),
  ]
}
