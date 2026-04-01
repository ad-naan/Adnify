/**
 * 编辑器情绪提示栏
 * 消费结构化 companion feedback，作为 editor 场景主入口。
 */

import React, { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { useStore } from '@store'
import { t } from '@/renderer/i18n'
import { EventBus } from '@/renderer/agent/core/EventBus'
import type { EmotionFeedbackPayload } from '@/renderer/agent/types/emotion'
import { useEmotionState } from '@/renderer/hooks/useEmotionState'
import { EMOTION_META } from '@/renderer/agent/emotion'
import { loadEmotionPanelSettings, subscribeEmotionPanelSettings } from '@/renderer/agent/emotion/panelSettings'

export const EmotionEditorBar: React.FC = () => {
  const language = useStore(s => s.language)
  const emotion = useEmotionState()
  const [feedback, setFeedback] = useState<EmotionFeedbackPayload | null>(null)
  const [hovered, setHovered] = useState(false)
  const [companionEnabled, setCompanionEnabled] = useState(loadEmotionPanelSettings().companionEnabled)

  useEffect(() => {
    return subscribeEmotionPanelSettings((settings) => setCompanionEnabled(settings.companionEnabled))
  }, [])

  useEffect(() => {
    if (!companionEnabled) {
      setFeedback(null)
      return
    }

    const unsubscribe = EventBus.on('emotion:feedback', (event) => {
      if (!event.feedback.channelHints?.includes('editorBar')) return
      setFeedback(event.feedback)
    })

    return () => unsubscribe()
  }, [companionEnabled])

  const state = emotion?.state || feedback?.emotionState || 'neutral'
  const meta = EMOTION_META[state]
  const intensity = emotion?.intensity ?? 0.5
  const actions = feedback?.actions || []
  const visible = companionEnabled && !!feedback && state !== 'neutral'

  const title = useMemo(() => {
    if (!feedback) return ''
    return feedback.shortMessage || feedback.message
  }, [feedback])

  const handleAction = (actionType?: string) => {
    if (!actionType || !emotion) {
      setFeedback(null)
      return
    }
    import('@/renderer/agent/emotion/emotionActions').then(({ getRecommendedActions }) => {
      const action = getRecommendedActions(emotion).find(item => item.type === actionType)
      action?.execute()
      setFeedback(null)
    }).catch(() => setFeedback(null))
  }

  return (
    <AnimatePresence>
      {visible && feedback && (
        <motion.div
          key={feedback.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          transition={{ duration: 0.25 }}
          className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none"
        >
          <div
            className="relative border-t border-white/10 bg-background-secondary/80 backdrop-blur-sm transition-all duration-300"
            style={{ borderTopColor: `${meta.color}30` }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <div className="px-4 py-2 flex items-center gap-3 pointer-events-auto">
              <div className="flex items-center gap-2 flex-shrink-0">
                <motion.div
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  className="text-lg"
                >
                  {meta.emoji}
                </motion.div>
                <div className="flex flex-col">
                  <span className="text-xs font-medium leading-none" style={{ color: meta.color }}>
                    {t(`emotion.state.${state}`, language)}
                  </span>
                  <div className="flex items-center gap-1 mt-0.5">
                    <div
                      className="h-1 rounded-full transition-all"
                      style={{ width: `${intensity * 60}px`, backgroundColor: meta.color, opacity: 0.6 }}
                    />
                    <span className="text-[9px] text-text-muted">{Math.round(intensity * 100)}%</span>
                  </div>
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-xs text-text-secondary leading-relaxed truncate" title={title}>
                  {title}
                </p>
              </div>

              {actions.length > 0 && (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {actions.slice(0, 2).map((action) => (
                    <motion.button
                      key={action.id}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium transition-colors border border-white/10 hover:border-white/20"
                      style={{ color: meta.color, backgroundColor: hovered ? `${meta.color}18` : `${meta.color}10` }}
                      onClick={() => handleAction(action.actionType)}
                    >
                      {action.emoji ? <span>{action.emoji}</span> : <Sparkles className="w-3.5 h-3.5" />}
                      <span>{action.label}</span>
                    </motion.button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
