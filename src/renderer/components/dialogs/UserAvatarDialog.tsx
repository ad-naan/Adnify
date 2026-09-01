import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Check, RefreshCw } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { Button, Modal } from '@components/ui'
import { t } from '@shared/i18n'

export default function UserAvatarDialog() {
  const {
    showAvatarDialog,
    setShowAvatarDialog,
    userAvatarStyle,
    userAvatarSeed,
    userDisplayName,
    setUserAvatar,
    setUserDisplayName,
    language,
  } = useStore(
    useShallow((s) => ({
      showAvatarDialog: s.showAvatarDialog,
      setShowAvatarDialog: s.setShowAvatarDialog,
      userAvatarStyle: s.userAvatarStyle,
      userAvatarSeed: s.userAvatarSeed,
      userDisplayName: s.userDisplayName,
      setUserAvatar: s.setUserAvatar,
      setUserDisplayName: s.setUserDisplayName,
      language: s.language,
    }))
  )

  const [style, setStyle] = useState(userAvatarStyle)
  const [seed, setSeed] = useState(userAvatarSeed)
  const [displayName, setDisplayName] = useState(userDisplayName)
  const [isRolling, setIsRolling] = useState(false)

  // 当弹窗打开时，同步最新的 Store 状态
  useEffect(() => {
    if (showAvatarDialog) {
      setStyle(userAvatarStyle)
      setSeed(userAvatarSeed)
      setDisplayName(userDisplayName)
    }
  }, [showAvatarDialog, userAvatarStyle, userAvatarSeed, userDisplayName])

  // 🎲 随机生成一个新的种子
  const rollSeed = () => {
    setIsRolling(true)
    const randomSeed = Math.random().toString(36).substring(2, 9).toUpperCase()
    setSeed(randomSeed)
    setTimeout(() => setIsRolling(false), 500)
  }

  const handleSave = () => {
    setUserAvatar(style, seed)
    if (displayName.trim()) {
      setUserDisplayName(displayName.trim())
    }
    setShowAvatarDialog(false)
  }

  const avatarUrl = `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(seed)}`

  // 国际化翻译资源
  const tTitle = t('userAvatarDialog.personalizeProfile', language)
  const tAvatarSeed = t('userAvatarDialog.avatarFeatureSeed', language)
  const tDisplayName = t('userAvatarDialog.displayName', language)
  const tPlaceholderName = t('userAvatarDialog.enterYourName', language)
  const tPlaceholderSeed = t('userAvatarDialog.enterSeed', language)
  const tTip = t('userAvatarDialog.tipEveryCharacterYouType', language)
  const tSelectStyle = t('userAvatarDialog.selectAvatarStyle', language)
  const tCancel = t('userAvatarDialog.cancel', language)
  const tSave = t('userAvatarDialog.applySettings', language)

  const avatarStyles = [
    { id: 'fun-emoji', name: t('userAvatarDialog.funEmoji', language), desc: t('userAvatarDialog.vibrantAndCheerfulEmoji', language) },
    { id: 'thumbs', name: t('userAvatarDialog.auroraGradient', language), desc: t('userAvatarDialog.highEndAbstractMinimalist', language) },
    { id: 'big-smile', name: t('userAvatarDialog.bigSmile', language), desc: t('userAvatarDialog.warmBrightAndCheerful', language) },
    { id: 'bottts-neutral', name: t('userAvatarDialog.minimalTech', language), desc: t('userAvatarDialog.cleanTechInspiredCybernetic', language) },
    { id: 'shapes', name: t('userAvatarDialog.abstractShapes', language), desc: t('userAvatarDialog.artisticMultiColorGeometric', language) },
    { id: 'croodles', name: t('userAvatarDialog.graffitiArtist', language), desc: t('userAvatarDialog.expressiveAndCreativeHandDrawn', language) },
    { id: 'adventurer', name: t('userAvatarDialog.adventurer', language), desc: t('userAvatarDialog.detailedAdventurous3dCartoon', language) },
    { id: 'lorelei', name: t('userAvatarDialog.loreleiPortrait', language), desc: t('userAvatarDialog.artisticAndElegantHandDrawn', language) },
  ]

  return (
    <Modal
      isOpen={showAvatarDialog}
      onClose={() => setShowAvatarDialog(false)}
      title={tTitle}
      size="md"
    >
      <div className="flex flex-col gap-5 select-none">
        
        {/* Central Card Area (Avatar Preview & Basic Profile info) */}
        <div className="flex items-center gap-5 p-4 rounded-2xl bg-surface/40 border border-border shadow-sm relative overflow-hidden">
          {/* Subtle Ambient Orb inside */}
          <div className="absolute -top-10 -right-10 w-24 h-24 bg-accent/8 rounded-full blur-xl pointer-events-none" />
          
          <div className="relative group/preview shrink-0 z-10">
            {/* Outer Glowing Ring */}
            <div className="absolute inset-0 bg-accent/20 rounded-full blur-md opacity-70 group-hover:scale-105 transition-transform" />
            
            {/* Avatar SVG Wrapper */}
            <motion.div
              key={`${style}-${seed}`}
              initial={{ scale: 0.8, rotate: -8 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              className="relative w-20 h-20 rounded-xl border border-border bg-gradient-to-tr from-accent/5 to-accent/15 overflow-hidden flex items-center justify-center shadow-lg"
            >
              <img
                src={avatarUrl}
                alt="Avatar Preview"
                className="w-full h-full object-cover select-none pointer-events-none"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            </motion.div>
          </div>

          {/* Profile Name & Seed Inputs */}
          <div className="flex-1 min-w-0 space-y-3 z-10">
            {/* User Name Input */}
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest pl-1">
                {tDisplayName}
              </span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={tPlaceholderName}
                maxLength={20}
                className="w-full bg-surface/60 border border-border/80 focus:border-accent/80 focus:ring-1 focus:ring-accent/30 rounded-xl px-3 py-1.5 text-xs text-text-primary focus:outline-none transition-all duration-200 shadow-sm"
              />
            </div>

            {/* Avatar Seed Input */}
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest pl-1">
                {tAvatarSeed}
              </span>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  placeholder={tPlaceholderSeed}
                  className="flex-1 bg-surface/60 border border-border/80 focus:border-accent/80 focus:ring-1 focus:ring-accent/30 rounded-xl px-3 py-1.5 text-xs font-mono text-text-primary focus:outline-none transition-all duration-200 shadow-sm"
                />
                
                <Button
                  variant="secondary"
                  onClick={rollSeed}
                  disabled={isRolling}
                  className="shrink-0 aspect-square p-2 justify-center rounded-xl bg-surface/80 border border-border text-text-secondary hover:text-accent hover:border-accent/30 hover:shadow-sm transition-all duration-200"
                  title={t('userAvatarDialog.randomSeed', language)}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRolling ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Small Tip */}
        <p className="text-[10px] text-text-muted pl-1 leading-normal">
          {tTip}
        </p>

        {/* Style Category Selector */}
        <div className="space-y-2">
          <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest pl-1">
            {tSelectStyle}
          </span>
          <div className="grid grid-cols-2 gap-2 max-h-[160px] overflow-y-auto custom-scrollbar pr-1">
            {avatarStyles.map((item) => {
              const isActive = style === item.id
              const previewImgUrl = `https://api.dicebear.com/7.x/${item.id}/svg?seed=Adnify`
              
              return (
                <div
                  key={item.id}
                  onClick={() => setStyle(item.id)}
                  className={`flex items-center gap-3 p-2.5 rounded-xl border transition-all duration-300 cursor-pointer ${
                    isActive
                      ? 'bg-accent/10 border-accent shadow-sm'
                      : 'bg-surface/40 border-border hover:bg-surface hover:border-accent/30'
                  }`}
                >
                  <div className="w-8 h-8 rounded-lg border border-border bg-surface/80 flex items-center justify-center overflow-hidden shrink-0">
                    <img src={previewImgUrl} alt={item.name} className="w-full h-full object-cover select-none pointer-events-none" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <span className={`text-xs font-semibold ${isActive ? 'text-accent' : 'text-text-primary'}`}>
                        {item.name}
                      </span>
                      {isActive && <Check className="w-2.5 h-2.5 text-accent shrink-0" />}
                    </div>
                    <p className="text-[9px] text-text-muted truncate mt-0.5">{item.desc}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-border/40">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowAvatarDialog(false)}
            className="text-xs"
          >
            {tCancel}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            className="text-xs px-5"
          >
            {tSave}
          </Button>
        </div>

      </div>
    </Modal>
  )
}
