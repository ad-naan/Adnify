/**
 * StatusBar 情绪指示器
 * 轻量展示当前情绪状态，并消费结构化 companion feedback。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ThumbsUp, ThumbsDown } from 'lucide-react'
import { useStore } from '@store'
import { t } from '@/renderer/i18n'
import { EventBus } from '@/renderer/agent/core/EventBus'
import { emotionFeedback } from '@/renderer/agent/emotion/emotionFeedback'
import type { EmotionFeedbackPayload } from '@/renderer/agent/types/emotion'
import { useEmotionState } from '@/renderer/hooks/useEmotionState'
import { EMOTION_META, EMOTION_STATUS_MESSAGE_KEYS } from '@/renderer/agent/emotion'
import { loadEmotionPanelSettings, subscribeEmotionPanelSettings } from '@/renderer/agent/emotion/panelSettings'

const EMOTION_MESSAGES = EMOTION_STATUS_MESSAGE_KEYS

export const EmotionStatusIndicator: React.FC = () => {
  const language = useStore(s => s.language)
  const emotion = useEmotionState()
  const [isHovered, setIsHovered] = useState(false)
  const [justChanged, setJustChanged] = useState(false)
  const [messageIndex, setMessageIndex] = useState(0)
  const [activeFeedback, setActiveFeedback] = useState<EmotionFeedbackPayload | null>(null)
  const [feedbackGiven, setFeedbackGiven] = useState(false)
  const [companionEnabled, setCompanionEnabled] = useState(loadEmotionPanelSettings().companionEnabled)
  const dismissTimerRef = useRef<NodeJS.Timeout | null>(null)
  const prevStateRef = useRef(emotion?.state || 'neutral')

  useEffect(() => {
    return subscribeEmotionPanelSettings((settings) => setCompanionEnabled(settings.companionEnabled))
  }, [])

  useEffect(() => {
    if (!emotion) return
    if (prevStateRef.current !== emotion.state) {
      setJustChanged(true)
      setMessageIndex(0)
      const timer = setTimeout(() => setJustChanged(false), 8000)
      prevStateRef.current = emotion.state
      return () => clearTimeout(timer)
    }
  }, [emotion])

  useEffect(() => {
    if (!emotion || emotion.state === 'neutral' || activeFeedback) return
    const messages = EMOTION_MESSAGES[emotion.state]
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % messages.length)
    }, 6000)
    return () => clearInterval(interval)
  }, [emotion?.state, activeFeedback])

  useEffect(() => {
    if (!companionEnabled) {
      setActiveFeedback(null)
      return
    }

    const unsub = EventBus.on('emotion:feedback', (event) => {
      const feedback = event.feedback
      if (!feedback.channelHints?.includes('statusBar')) return
      setActiveFeedback(feedback)
      setFeedbackGiven(false)
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
      if (feedback.expiresAt) {
        dismissTimerRef.current = setTimeout(() => {
          setActiveFeedback((current) => current?.id === feedback.id ? null : current)
        }, Math.max(0, feedback.expiresAt - Date.now()))
      }
    })

    return () => {
      unsub()
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    }
  }, [companionEnabled])

  const state = emotion?.state || 'neutral'
  const meta = EMOTION_META[state]
  const intensity = emotion?.intensity ?? 0.5
  const label = t(meta.translationKey, language)
  const messages = EMOTION_MESSAGES[state]
  const currentMessageKey = messages[messageIndex]

  const dismissFeedback = () => {
    setActiveFeedback(null)
    setFeedbackGiven(false)
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = null
    }
  }

  const handleFeedback = (accurate: boolean) => {
    if (!activeFeedback || feedbackGiven) return
    emotionFeedback.recordFeedback(activeFeedback.emotionState, accurate ? 'accurate' : 'inaccurate')
    setFeedbackGiven(true)
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    dismissTimerRef.current = setTimeout(() => dismissFeedback(), 2000)
  }

  const handleAction = (actionType?: string) => {
    if (!actionType) {
      dismissFeedback()
      return
    }
    const detection = emotion
    if (!detection) {
      dismissFeedback()
      return
    }
    import('@/renderer/agent/emotion/emotionActions').then(({ getRecommendedActions }) => {
      const action = getRecommendedActions(detection).find(item => item.type === actionType)
      action?.execute()
      dismissFeedback()
    }).catch(() => dismissFeedback())
  }

  const detailText = useMemo(() => {
    if (activeFeedback) return activeFeedback.message
    return currentMessageKey ? t(currentMessageKey as any, language) : ''
  }, [activeFeedback, currentMessageKey, language])

  return (
    <div
      className="relative flex items-center h-full gap-2"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <button
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-all duration-500 ease-out relative overflow-hidden ${activeFeedback
          ? 'bg-surface/80 backdrop-blur-md shadow-lg border border-white/10'
          : justChanged
            ? 'bg-surface/50 backdrop-blur-sm border border-white/5'
            : 'hover:bg-white/5 border border-transparent'
          }`}
        onClick={() => activeFeedback ? dismissFeedback() : setMessageIndex((prev) => messages.length > 0 ? (prev + 1) % messages.length : 0)}
      >
        {activeFeedback && (
          <motion.div
            className="absolute inset-0 opacity-20 pointer-events-none"
            animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
            transition={{ duration: 5, ease: 'linear', repeat: Infinity }}
            style={{
              backgroundImage: `linear-gradient(90deg, transparent, ${meta.color}, transparent)`,
              backgroundSize: '200% 100%'
            }}
          />
        )}
        <div className="relative flex-shrink-0">
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{ backgroundColor: meta.color }}
            animate={{ scale: [1, 1.8, 1], opacity: [0.4, 0, 0.4] }}
            transition={{ duration: meta.pulseSpeed, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="w-2.5 h-2.5 rounded-full relative z-10"
            style={{ backgroundColor: meta.color }}
            animate={justChanged || activeFeedback ? { scale: [1, 1.5, 1] } : { opacity: [0.7, 1, 0.7] }}
            transition={justChanged || activeFeedback ? { duration: 0.5, type: 'spring' } : { duration: meta.pulseSpeed, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>

        <AnimatePresence mode="wait">
          {(activeFeedback || justChanged || isHovered) && (
            <motion.div
              key={activeFeedback ? activeFeedback.id : state}
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="overflow-hidden whitespace-nowrap pl-0.5 pr-1 text-[10px] font-medium relative z-10"
              style={{ color: activeFeedback ? 'var(--text-primary)' : meta.color }}
            >
              {activeFeedback ? activeFeedback.shortMessage || activeFeedback.message : `${meta.emoji} ${label}`}
            </motion.div>
          )}
        </AnimatePresence>
      </button>

      {!activeFeedback && emotion && emotion.state !== 'neutral' && (isHovered || justChanged) && detailText && (
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          className="flex items-center gap-2 px-2 py-1 rounded-md bg-background-secondary/95 backdrop-blur-sm border border-white/10 max-w-[220px]"
        >
          <motion.span
            key={messageIndex}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.2 }}
            className="text-[10px] text-text-secondary leading-relaxed truncate"
          >
            {detailText}
          </motion.span>
        </motion.div>
      )}

      <AnimatePresence>
        {(isHovered || !!activeFeedback) && emotion && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-[200]"
          >
            <div className="bg-background-secondary/95 backdrop-blur-xl border border-white/10 rounded-xl p-3 shadow-2xl min-w-[220px]">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: meta.color }} />
                <span className="text-sm font-medium text-text-primary">{meta.emoji} {label}</span>
                <span
                  className="text-xs px-1.5 py-0.5 rounded-full ml-auto"
                  style={{ backgroundColor: `${meta.color}20`, color: meta.color }}
                >
                  {Math.round(intensity * 100)}%
                </span>
              </div>

              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden mb-3">
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundColor: meta.color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${intensity * 100}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>

              <p className="text-[11px] text-text-primary leading-relaxed">
                {detailText || (emotion.suggestions?.[0] || '')}
              </p>

              {activeFeedback?.actions && activeFeedback.actions.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {activeFeedback.actions.map((action) => (
                    <button
                      key={action.id}
                      onClick={() => handleAction(action.actionType)}
                      className="flex items-center gap-1 px-2 py-1.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-text-secondary hover:text-text-primary transition-colors border border-white/5"
                    >
                      {action.emoji && <span>{action.emoji}</span>}
                      {action.label}
                    </button>
                  ))}
                </div>
              )}

              {activeFeedback?.showFeedback && (
                <div className="flex items-center gap-2 mt-3">
                  {feedbackGiven ? (
                    <span className="text-[9px] text-text-muted">{t('emotion.companion.feedbackThanks', language)}</span>
                  ) : (
                    <>
                      <span className="text-[9px] text-text-muted">{t('emotion.companion.feedbackQuestion', language)}</span>
                      <button onClick={() => handleFeedback(true)} className="p-1 rounded bg-white/5 hover:bg-green-500/10 text-text-muted hover:text-green-400 transition-colors">
                        <ThumbsUp className="w-2.5 h-2.5" />
                      </button>
                      <button onClick={() => handleFeedback(false)} className="p-1 rounded bg-white/5 hover:bg-red-500/10 text-text-muted hover:text-red-400 transition-colors">
                        <ThumbsDown className="w-2.5 h-2.5" />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
