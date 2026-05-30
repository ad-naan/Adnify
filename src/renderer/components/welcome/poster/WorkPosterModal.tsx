import { useEffect, useMemo, useState } from 'react'
import { Download, Shuffle } from 'lucide-react'
import { Modal } from '@components/ui'
import { WorkPosterData } from './types'
import { WorkPosterCanvas } from './WorkPosterCanvas'
import { WORK_POSTER_CANVAS_ID } from './workPosterAssets'
import { downloadCanvasPng } from './download'
import { fetchWorkPosterQuote } from './workPosterQuote'
import './workPoster.css'

interface WorkPosterModalProps {
  isOpen: boolean
  onClose: () => void
  poster: WorkPosterData
}

export function WorkPosterModal({ isOpen, onClose, poster }: WorkPosterModalProps) {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9))
  const [quote, setQuote] = useState<string | null>(null)
  const isZh = poster.language === 'zh'
  const posterWithQuote = useMemo(() => ({
    ...poster,
    quote: quote ?? '',
  }), [poster, quote])

  useEffect(() => {
    if (!isOpen) return

    const controller = new AbortController()
    setQuote(null)
    fetchWorkPosterQuote(poster.language, controller.signal)
      .then(setQuote)
      .catch(() => setQuote(''))

    return () => controller.abort()
  }, [isOpen, poster.language, seed])

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isZh ? '生成工作海报' : 'Generate Work Poster'}
      size="4xl"
      className="max-h-[88vh]"
    >
      <div className="report-modal">
        <div className="report-preview-wrap">
          <div className="report-poster-shell">
            <WorkPosterCanvas poster={posterWithQuote} seed={seed} />
            {quote === null && (
              <div className="report-quote-loading" role="status" aria-live="polite">
                <span className="report-quote-spinner" />
                <span>{isZh ? '正在获取一言' : 'Loading quote'}</span>
              </div>
            )}
          </div>
        </div>
        <div className="report-side">
          <div>
            <h4>{isZh ? '今日工作切片' : 'Work Snapshot'}</h4>
            <p>
              {isZh
                ? '把当前统计导出成一张适合收藏或分享的海报，数据来自本地工作区记录。'
                : 'Export the current workspace stats as a polished poster generated locally from this dashboard.'}
            </p>
          </div>
          <div className="report-side-stats">
            <span>{isZh ? '节奏评分' : 'Rhythm Score'} <strong>{poster.score}</strong></span>
            <span>{isZh ? '最高峰值' : 'Peak'} <strong>{poster.peak}</strong></span>
            <span>AI <strong>{poster.aiShare}</strong></span>
          </div>
          <div className="report-actions">
            <button onClick={() => setSeed(Math.floor(Math.random() * 1e9))}>
              <Shuffle className="w-4 h-4" />
              {isZh ? '换一版' : 'Shuffle'}
            </button>
            <button
              disabled={quote === null}
              onClick={() => downloadCanvasPng(WORK_POSTER_CANVAS_ID, posterWithQuote.fileBaseName)}
            >
              <Download className="w-4 h-4" />
              PNG
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
