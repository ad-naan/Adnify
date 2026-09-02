import { Files, Search, GitBranch, Settings, AlertCircle, ListTree, History, Terminal } from 'lucide-react'
import { Tooltip } from '../ui/Tooltip'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { t } from '@shared/i18n'
import { useEmotionState } from '@/renderer/hooks/useEmotionState'
import { EMOTION_OTTER_ASSETS, otterAssetSrc } from '@/renderer/components/brand/otterAssets'
import { EMOTION_COLORS, EMOTION_META } from '@/renderer/agent/emotion/constants'
import type { EmotionState } from '@/renderer/agent/types/emotion'

/** 情绪状态对应的水獭图片按钮 */
function EmotionButton({ isActive, onClick, label }: { isActive: boolean; onClick: () => void; label: string }) {
  const emotion = useEmotionState()
  const language = useStore(state => state.language)
  const state: EmotionState = emotion?.state ?? 'neutral'
  const assetKey = EMOTION_OTTER_ASSETS[state]
  const src = otterAssetSrc(assetKey)
  const dotColor = EMOTION_COLORS[state]

  return (
    <Tooltip content={label} side="right">
      <button
        onClick={onClick}
        className={`
          w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 group relative
          ${isActive
            ? 'bg-accent/10'
            : 'hover:bg-surface-hover active:scale-95'}
        `}
      >
        <img
          src={src}
          alt={t(EMOTION_META[state].translationKey, language)}
          draggable={false}
          className={`w-7 h-7 object-contain transition-all duration-300 select-none
            ${isActive ? 'scale-110 drop-shadow-[0_0_8px_rgba(99,102,241,0.5)]' : 'opacity-80 group-hover:opacity-100 group-hover:scale-110'}
          `}
        />
        {/* 情绪状态指示点 */}
        <span
          className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full transition-colors duration-500"
          style={{ background: dotColor, opacity: emotion ? 1 : 0.4 }}
        />
      </button>
    </Tooltip>
  )
}

export default function ActivityBar() {
  const { activeSidePanel, setActiveSidePanel, language, setShowSettings } = useStore(useShallow(s => ({ activeSidePanel: s.activeSidePanel, setActiveSidePanel: s.setActiveSidePanel, language: s.language, setShowSettings: s.setShowSettings })))

  const navItems = [
    { id: 'explorer', icon: Files, label: t('explorer', language) },
    { id: 'search', icon: Search, label: t('search', language) },
    { id: 'git', icon: GitBranch, label: 'Git' },
    { id: 'problems', icon: AlertCircle, label: t('activityBar.problems', language) },
    { id: 'outline', icon: ListTree, label: t('activityBar.outline', language) },
    { id: 'history', icon: History, label: t('git.history', language) },
    { id: 'shell', icon: Terminal, label: 'Shell' },
  ] as const

  return (
    <div
      className="bg-background-secondary/80 backdrop-blur-xl border-r border-border/30 shadow-[1px_0_15px_rgba(0,0,0,0.03)] flex flex-col z-30 select-none items-center py-4"
      style={{ width: 'var(--layout-sidebar-width)' }}
    >
      {/* Top Actions */}
      <div className="flex-1 flex flex-col w-full items-center gap-3">
        {navItems.map((item) => (
          <Tooltip key={item.id} content={item.label} side="right">
            <button
              onClick={() => setActiveSidePanel(activeSidePanel === item.id ? null : item.id)}
              className={`
                w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 group relative
                ${activeSidePanel === item.id
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-muted hover:text-text-primary hover:bg-surface-hover active:scale-95'}
              `}
            >
              <item.icon
                className={`w-[22px] h-[22px] transition-all duration-300 
                  ${activeSidePanel === item.id ? 'drop-shadow-[0_0_10px_rgba(var(--accent)/0.6)] scale-105' : 'opacity-70 group-hover:opacity-100 group-hover:scale-105'}
                `}
                strokeWidth={activeSidePanel === item.id ? 2 : 1.5}
              />
            </button>
          </Tooltip>
        ))}
      </div>

      {/* Bottom Actions */}
      <div className="flex flex-col w-full items-center gap-3 pb-2">
        {/* 情绪感知 - 水獭IP按钮（设置按钮上方） */}
        <EmotionButton
          isActive={activeSidePanel === 'emotion'}
          onClick={() => setActiveSidePanel(activeSidePanel === 'emotion' ? null : 'emotion')}
          label={t('activityBar.mood', language)}
        />
        <Tooltip content={t('settings', language)} side="right">
          <button
            onClick={() => setShowSettings(true)}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover active:scale-95 transition-all duration-300 group"
          >
            <Settings className="w-[22px] h-[22px] opacity-70 group-hover:opacity-100 group-hover:rotate-45 transition-all duration-500" strokeWidth={1.5} />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
