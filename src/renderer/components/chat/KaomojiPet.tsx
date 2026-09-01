import { motion } from 'framer-motion'
import { OtterAsset } from '@/renderer/components/brand/OtterAsset'
import { t, type Language } from '@shared/i18n'

interface KaomojiPetProps {
  language: Language
  isStreaming?: boolean
  hasInput?: boolean
}

export function KaomojiPet({ language, isStreaming = false, hasInput = false }: KaomojiPetProps) {
  const label = isStreaming
    ? (t('kaomojiPet.responding', language))
    : hasInput
      ? (t('kaomojiPet.ready', language))
      : (t('kaomojiPet.standing', language))

  const detail = isStreaming
    ? (t('kaomojiPet.queueIsAvailable', language))
    : hasInput
      ? (t('kaomojiPet.enterToSend', language))
      : (t('kaomojiPet.typeOrAttachAn', language))

  return (
    <div
      className="group flex min-w-0 items-center gap-2.5 select-none"
      title={t('kaomojiPet.adnifyCompanionStatus', language)}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        whileHover={{ y: -1, scale: 1.06 }}
        transition={{ duration: 0.18 }}
        className="relative h-8 w-8 shrink-0 rounded-full bg-surface/40 p-[2px] ring-1 ring-white/10 shadow-sm"
      >
        <OtterAsset asset={isStreaming ? 'typing' : 'assistantFace'} className="h-full w-full rounded-full object-cover" />
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
