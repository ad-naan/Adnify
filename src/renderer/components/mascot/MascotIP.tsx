import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { publicAsset } from '@utils/publicAsset'

export function MascotIP() {
  const { chatVisible, setChatVisible, language } = useStore(useShallow(s => ({
    chatVisible: s.chatVisible,
    setChatVisible: s.setChatVisible,
    language: s.language,
  })))

  const [isHovered, setIsHovered] = useState(false)

  const handleToggle = () => {
    setChatVisible(!chatVisible)
  }

  const mascotSrc = publicAsset('brand/ip/ai-avatar.gif')

  return (
    <div className="relative no-drag flex items-center justify-center w-8 h-8">
      <motion.button
        className={`relative w-full h-full flex items-center justify-center rounded-lg transition-colors ${chatVisible ? 'bg-accent/10' : 'hover:bg-text-primary/[0.05]'}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={handleToggle}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        <img
          src={mascotSrc}
          alt="Adnify Mascot"
          className="w-5 h-5 object-contain"
          draggable={false}
        />

        {/* 鼠标悬浮气泡提示 */}
        <AnimatePresence>
          {isHovered && (
            <motion.div
              initial={{ opacity: 0, y: 5, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="absolute top-[120%] right-0 whitespace-nowrap bg-surface-active/90 backdrop-blur-md border border-border text-text-primary text-xs px-3 py-1.5 rounded-lg shadow-xl font-medium z-[9999]"
            >
              {language === 'zh' ? (chatVisible ? '关闭 AI 助手' : '呼叫 AI 助手') : (chatVisible ? 'Close AI Assistant' : 'Call AI Assistant')}
              <div className="absolute -top-1.5 right-3 w-3 h-3 bg-surface-active/90 border-l border-t border-border rotate-45" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  )
}
