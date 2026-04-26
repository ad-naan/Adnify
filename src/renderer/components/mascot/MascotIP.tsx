import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'

export function MascotIP() {
  const { chatVisible, setChatVisible, language, chatWidth } = useStore(useShallow(s => ({
    chatVisible: s.chatVisible,
    setChatVisible: s.setChatVisible,
    language: s.language,
    chatWidth: s.chatWidth || 450
  })))

  const [isHovered, setIsHovered] = useState(false)
  const [isPeeking, setIsPeeking] = useState(false)

  // 随机探头逻辑 (Random peek logic)
  useEffect(() => {
    if (chatVisible) return

    const interval = setInterval(() => {
      if (Math.random() > 0.7) {
        setIsPeeking(true)
        setTimeout(() => setIsPeeking(false), 3500)
      }
    }, 15000)

    return () => clearInterval(interval)
  }, [chatVisible])

  const handleToggle = () => {
    setChatVisible(!chatVisible)
  }

  const mascotSrc = '/brand/ip/ai-avatar.gif'

  return (
    <div
      className="fixed right-0 top-1/2 -translate-y-1/2 z-[9999] pointer-events-none select-none"
      style={{ width: '64px', height: '64px' }}
    >
      <motion.div
        className="relative w-full h-full pointer-events-auto cursor-pointer flex items-center justify-center"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={handleToggle}
        // x: 0 完全露出, x: 50 缩回去大部分
        initial={{ x: 60 }}
        animate={{
          // 打开状态下，它贴着 AI 面板的左边缘
          x: chatVisible ? -chatWidth + 24 : (isHovered || isPeeking ? 0 : 50),
          scale: isHovered ? 1.05 : 1
        }}
        transition={{
          type: "spring",
          stiffness: 250,
          damping: 25,
          mass: 0.8
        }}
        whileTap={{ scale: 0.9 }}
      >
        <img
          src={mascotSrc}
          alt="Adnify Mascot"
          className="w-full h-full object-contain drop-shadow-[-4px_0_12px_rgba(var(--accent)/0.6)]"
          draggable={false}
        />

        {/* 鼠标悬浮气泡提示 */}
        <AnimatePresence>
          {isHovered && !chatVisible && (
            <motion.div
              initial={{ opacity: 0, x: 10, scale: 0.8 }}
              animate={{ opacity: 1, x: -10, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="absolute right-[110%] top-1/2 -translate-y-1/2 whitespace-nowrap bg-surface-active/90 backdrop-blur-md border border-border text-text-primary text-xs px-3 py-1.5 rounded-lg shadow-xl font-medium"
            >
              {language === 'zh' ? '呼叫 AI 助手' : 'Call AI Assistant'}
              <div className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-3 h-3 bg-surface-active/90 border-r border-t border-border rotate-45" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
