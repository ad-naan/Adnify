import { motion } from 'framer-motion'
import { OtterAsset } from '@/renderer/components/brand/OtterAsset'

interface KaomojiPetProps {
  language?: string
  isStreaming?: boolean
  hasInput?: boolean
}

export function KaomojiPet({ language = 'en', isStreaming = false, hasInput = false }: KaomojiPetProps) {
  const label = isStreaming
    ? (language === 'zh' ? '正在回复' : 'Responding')
    : hasInput
      ? (language === 'zh' ? '准备发送' : 'Ready')
      : (language === 'zh' ? '待命中' : 'Standing by')

  const detail = isStreaming
    ? (language === 'zh' ? '可继续排队' : 'Queue is available')
    : hasInput
      ? (language === 'zh' ? 'Enter 发送' : 'Enter to send')
      : (language === 'zh' ? '输入想法或添加图片' : 'Type or attach an image')

  return (
    <div
      className="group flex min-w-0 items-center gap-2.5 select-none"
      title={language === 'zh' ? 'Adnify 小助手状态' : 'Adnify companion status'}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        whileHover={{ y: -1, scale: 1.06 }}
        transition={{ duration: 0.18 }}
        className="relative h-8 w-8 shrink-0 rounded-full bg-surface/40 p-[2px] ring-1 ring-white/10 shadow-sm"
      >
        <OtterAsset asset={isStreaming ? 'assistant' : 'assistantFace'} className="h-full w-full rounded-full object-cover" />
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-background ${
            isStreaming ? 'animate-pulse bg-accent shadow-[0_0_10px_rgba(var(--accent),0.7)]' : 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.7)]'
          }`}
        />
      </motion.div>
      <div className="hidden min-w-0 flex-col sm:flex">
        <span className="truncate text-[11px] font-medium leading-4 text-text-secondary">{label}</span>
        <span className="truncate text-[10px] leading-3 text-text-muted/55">{detail}</span>
      </div>
    </div>
  )
}
