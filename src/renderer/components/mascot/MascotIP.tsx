import { motion } from 'framer-motion'
import { useStore } from '@store'
import { useModeStore } from '@/renderer/store'
import { useShallow } from 'zustand/react/shallow'
import { OtterAsset } from '@/renderer/components/brand/OtterAsset'
import ModeSelector from '@/renderer/components/chat/ModeSelector'

export function MascotIP() {
  const { chatVisible, setChatVisible, language } = useStore(useShallow(s => ({
    chatVisible: s.chatVisible,
    setChatVisible: s.setChatVisible,
    language: s.language,
  })))

  const mode = useModeStore(s => s.currentMode)
  const setMode = useModeStore(s => s.setMode)

  const handleToggle = () => {
    setChatVisible(!chatVisible)
  }

  const handleModeChange = (nextMode: Parameters<typeof setMode>[0]) => {
    setMode(nextMode)
    if (!chatVisible) setChatVisible(true)
  }

  return (
    <div className="no-drag flex h-10 items-center gap-1.5">
        <ModeSelector mode={mode} onModeChange={handleModeChange} />

        <motion.button
          className={`relative z-[2] flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-background shadow-[0_4px_14px_rgba(15,23,42,0.12)] transition-all ${chatVisible ? 'border-accent/30 ring-2 ring-accent/10' : 'border-border/55 hover:border-accent/25'}`}
          onClick={handleToggle}
          aria-label={language === 'zh' ? (chatVisible ? '关闭 AI 助手' : '打开 AI 助手') : (chatVisible ? 'Close AI Assistant' : 'Open AI Assistant')}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <OtterAsset
            asset={chatVisible ? 'assistantFace' : 'assistant'}
            alt="Adnify Mascot"
            className="h-9 w-9 rounded-full object-cover"
          />
          <span className="absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full border border-background bg-accent" />
        </motion.button>
    </div>
  )
}
