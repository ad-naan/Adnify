import { useEffect, useRef, useState } from 'react'
import { WorkPosterData } from './types'
import { WORK_POSTER_CANVAS_ID, WORK_POSTER_HEIGHT, WORK_POSTER_WIDTH } from './workPosterAssets'
import { renderWorkPoster } from './workPosterRenderer'

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
            ? (poster.language === 'zh' ? '海报素材加载失败' : 'Poster assets failed to load')
            : (poster.language === 'zh' ? '生成中...' : 'Rendering...')}
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
