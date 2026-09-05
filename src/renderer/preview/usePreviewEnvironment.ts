import { useEffect, useRef, useState, type RefObject } from 'react'
import { api } from '@renderer/services/electronAPI'
import { fitPreviewDevice, getPreviewDeviceSize, type PreviewDevice, type PreviewOrientation, type PreviewPartitionResult } from '@shared/preview/device'
import type { PreviewWebviewElement } from '@renderer/types/webview'
import { loadPreviewSettings, subscribePreviewSettings, updatePreviewSettings } from './previewSettings'

export function usePreviewEnvironment(sessionId: string | undefined, workspaceRoot: string | undefined,
  guestRef: RefObject<PreviewWebviewElement>, zoomLevel: number) {
  const key = JSON.stringify([sessionId, workspaceRoot])
  const [prepared, setPrepared] = useState<{ key: string; result: PreviewPartitionResult }>()
  const [attempt, setAttempt] = useState(0)
  const [device, setDevice] = useState<PreviewDevice>(() => loadPreviewSettings().device)
  const [orientation, setOrientation] = useState<PreviewOrientation>(() => loadPreviewSettings().orientation)
  const [available, setAvailable] = useState({ width: 0, height: 0 })
  const [deviceFailed, setDeviceFailed] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const ready = useRef(false)
  const revision = useRef(0)
  const size = getPreviewDeviceSize(device, orientation)
  const scale = fitPreviewDevice(size, available)
  const result = prepared?.key === key ? prepared.result : undefined
  const partition = result?.success ? result.partition : undefined

  useEffect(() => {
    const sync = (settings: ReturnType<typeof loadPreviewSettings>) => {
      setDevice(settings.device)
      setOrientation(settings.orientation)
    }
    const unsubscribe = subscribePreviewSettings(sync)
    // Hydration can finish between the initial render and this subscription.
    sync(loadPreviewSettings())
    return unsubscribe
  }, [])

  useEffect(() => {
    let canceled = false
    ready.current = false
    setDeviceFailed(false)
    setPrepared(undefined)
    if (sessionId) {
      void api.preview.prepareSession(workspaceRoot).then(value => {
        if (!canceled) setPrepared({ key, result: value })
      }).catch(() => { if (!canceled) setPrepared({ key, result: { success: false } }) })
    }
    return () => { canceled = true; ready.current = false; revision.current++ }
  }, [key, sessionId, workspaceRoot, attempt])

  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setAvailable({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const apply = useRef<() => Promise<void>>(async () => {})
  apply.current = async () => {
    const guest = guestRef.current
    if (!guest || !ready.current || !partition || available.width <= 0 || available.height <= 0) return
    const current = ++revision.current
    try {
      const response = await api.preview.configureDevice({ targetId: guest.getWebContentsId(), device, orientation, scale })
      if (current !== revision.current || guest !== guestRef.current) return
      if (!response.success) throw new Error('Device configuration failed')
      if (device === 'desktop') guest.setZoomLevel(zoomLevel)
      setDeviceFailed(false)
    } catch {
      if (current === revision.current && guest === guestRef.current) setDeviceFailed(true)
    }
  }

  useEffect(() => {
    revision.current++
    const timer = window.setTimeout(() => void apply.current(), 100)
    return () => window.clearTimeout(timer)
  }, [device, orientation, scale, partition])

  return {
    partition, scope: result?.success ? result.scope : undefined,
    partitionFailed: result?.success === false,
    retryPartition: () => setAttempt(value => value + 1),
    device, orientation, size, scale, viewportRef, deviceFailed,
    retryDevice: () => void apply.current(),
    onDomReady: () => { ready.current = true; void apply.current() },
    onDestroyed: () => { ready.current = false; revision.current++ },
    changeDevice: (value: PreviewDevice) => { setDevice(value); updatePreviewSettings({ device: value }) },
    rotate: () => {
      const next = orientation === 'portrait' ? 'landscape' : 'portrait'
      setOrientation(next)
      updatePreviewSettings({ orientation: next })
    },
  }
}
