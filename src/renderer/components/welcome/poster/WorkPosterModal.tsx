import { useEffect, useMemo, useState } from 'react'
import { Download, Shuffle } from 'lucide-react'
import { Modal } from '@components/ui'
import { WorkPosterData } from './types'
import { WorkPosterCanvas } from './WorkPosterCanvas'
import { WORK_POSTER_CANVAS_ID } from './workPosterAssets'
import { downloadCanvasPng } from './download'
import { fetchWorkPosterQuote } from './workPosterQuote'
import { t, type Language } from '@shared/i18n'
import './workPoster.css'

interface WorkPosterModalProps {
  isOpen: boolean
  onClose: () => void
  poster: WorkPosterData
}

export function WorkPosterModal({ isOpen, onClose, poster }: WorkPosterModalProps) {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9))
  const [quote, setQuote] = useState<string | null>(null)
  const [signature, setSignature] = useState(() => poster.signature || 'adnaan')
  const lang: Language = poster.language

  useEffect(() => {
    if (isOpen) {
      setSignature(poster.signature || 'adnaan')
    }
  }, [isOpen, poster.signature])

  const posterWithQuote = useMemo(() => ({
    ...poster,
    quote: quote ?? '',
    signature: signature,
  }), [poster, quote, signature])

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
      title={t('workPosterModal.generateWorkPoster', lang)}
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
                <span>{t('workPosterModal.loadingQuote', lang)}</span>
              </div>
            )}
          </div>
        </div>
        <div className="report-side">
          <div>
            <h4>{t('workPosterModal.workSnapshot', lang)}</h4>
            <p>
              {t('workPosterModal.exportTheCurrentWorkspace', lang)}
            </p>
          </div>
          <div className="report-side-stats">
            <span>{t('workPosterModal.rhythmScore', lang)} <strong>{poster.score}</strong></span>
            <span>{t('workPosterModal.peak', lang)} <strong>{poster.peak}</strong></span>
            <span>AI <strong>{poster.aiShare}</strong></span>
          </div>
          <div className="report-signature-wrap">
            <label className="report-signature-label">
              {t('workPosterModal.signature', lang)}
            </label>
            <input
              type="text"
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder="adnaan"
              maxLength={20}
              className="report-signature-input"
            />
          </div>
          <div className="report-actions">
            <button onClick={() => setSeed(Math.floor(Math.random() * 1e9))}>
              <Shuffle className="w-4 h-4" />
              {t('workPosterModal.shuffle', lang)}
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
