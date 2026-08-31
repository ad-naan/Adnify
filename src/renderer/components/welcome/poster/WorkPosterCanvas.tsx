import { useEffect, useRef, useState } from 'react'
import { WorkPosterData } from './types'
import { WORK_POSTER_CANVAS_ID, WORK_POSTER_HEIGHT, WORK_POSTER_WIDTH } from './workPosterAssets'
import { renderWorkPoster } from './workPosterRenderer'
import { t, asLanguage } from '@renderer/i18n'

export function WorkPosterCanvas({
  poster,
  seed,
}: {
  poster: WorkPosterData
  seed: number
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    let cancelled = false
    setStatus('loading')
    renderWorkPoster(ctx, poster, seed)
      .then(() => {
        if (!cancelled) setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => { cancelled = true }
  }, [poster, seed])

  return (
    <div className="report-poster-frame">
      {status !== 'ready' && (
        <div className="report-poster-status">
          {status === 'error'
            ? (t('workPosterCanvas.posterAssetsFailedTo', asLanguage(poster.language)))
            : (t('workPosterCanvas.rendering', asLanguage(poster.language)))}
        </div>
      )}
      <canvas
        id={WORK_POSTER_CANVAS_ID}
        ref={canvasRef}
        width={WORK_POSTER_WIDTH}
        height={WORK_POSTER_HEIGHT}
        className="report-poster-canvas"
      />
    </div>
  )
}
