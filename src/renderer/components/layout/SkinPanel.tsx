import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, LayoutTemplate, Palette, Sparkles, ZoomIn, X } from 'lucide-react'
import { useStore, type ThemeName } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { saveEditorConfig } from '@renderer/settings'
import { themeManager } from '@renderer/config/themeConfig'
import { api } from '@/renderer/services/electronAPI'
import ThemeWorkbenchPreview from '@renderer/components/theme/ThemeWorkbenchPreview'
import { t, type TranslationKey } from '@shared/i18n'

const SCALE_PRESETS = [0.8, 0.9, 1, 1.1, 1.25] as const

// `id` 是持久化的 `layoutDensity` 取值，所以 `as const` 的窄化要保住 —— 只有文案换成键。
const LAYOUT_PRESETS = [
  { id: 'compact', nameKey: 'skinPanel.density.compact', detailKey: 'skinPanel.density.compactDetail' },
  { id: 'comfortable', nameKey: 'skinPanel.density.comfortable', detailKey: 'skinPanel.density.comfortableDetail' },
  { id: 'expanded', nameKey: 'skinPanel.density.expanded', detailKey: 'skinPanel.density.expandedDetail' },
] as const satisfies ReadonlyArray<{ id: string, nameKey: TranslationKey, detailKey: TranslationKey }>

export default function SkinPanel() {
  const {
    language,
    currentTheme,
    setTheme,
    editorConfig,
    setEditorConfig,
  } = useStore(useShallow(state => ({
    language: state.language,
    currentTheme: state.currentTheme,
    setTheme: state.setTheme,
    editorConfig: state.editorConfig,
    setEditorConfig: state.set,
  })))

  const [open, setOpen] = useState(false)
  const [zoomFactor, setZoomFactor] = useState(1)
  const panelRef = useRef<HTMLDivElement>(null)
  const themes = useMemo(() => themeManager.getAllThemes(), [])

  useEffect(() => {
    if (!open) return

    void api.window.getZoomFactor().then(setZoomFactor).catch(() => setZoomFactor(1))
  }, [open])

  useEffect(() => {
    if (!open) return

    const handleOutsideClick = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [open])

  const applyTheme = (themeId: string) => {
    setTheme(themeId as ThemeName)
    themeManager.setTheme(themeId)
    void api.settings.set('themeId', themeId)
  }

  const applyUiScale = async (uiScale: number) => {
    const nextValue = Number(uiScale.toFixed(2))
    const actual = await api.window.setZoomFactor(nextValue)
    setZoomFactor(actual)
    setEditorConfig('editorConfig', { ...editorConfig, uiScale: actual })
    saveEditorConfig({ uiScale: actual })
  }

  const applyLayoutDensity = (layoutDensity: 'compact' | 'comfortable' | 'expanded') => {
    setEditorConfig('editorConfig', { ...editorConfig, layoutDensity })
    saveEditorConfig({ layoutDensity })
  }

  const copy = {
    title: t('skinPanel.skin', language),
    subtitle: t('skinPanel.themeScaleAndLayout', language),
    theme: t('skinPanel.theme', language),
    scale: t('skinPanel.pageScale', language),
    density: t('skinPanel.layout', language),
  }

  return (
    <div className="relative z-50" ref={panelRef}>
      <button
        onClick={() => setOpen(value => !value)}
        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
          open
            ? 'bg-accent/12 text-accent ring-1 ring-accent/20'
            : 'text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05]'
        }`}
        title={copy.title}
      >
        <Palette className="w-4 h-4" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={{ type: 'spring', damping: 24, stiffness: 380 }}
            className="absolute right-0 top-full mt-3 w-[560px] max-w-[calc(100vw-2rem)] rounded-3xl border border-border/70 bg-background-secondary/95 backdrop-blur-xl shadow-[0_20px_50px_rgba(0,0,0,0.28)] overflow-hidden origin-top-right"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/40 bg-background-secondary/70">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-text-muted">{copy.title}</div>
                <div className="mt-1 text-sm text-text-secondary">{copy.subtitle}</div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-full hover:bg-white/10 text-text-muted transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="max-h-[min(70vh,640px)] overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-[1.2fr_0.9fr] gap-5 p-5">
                <section className="space-y-3 min-w-0">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-text-muted">
                    <Sparkles className="w-3.5 h-3.5" />
                    {copy.theme}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {themes.map(theme => {
                      const active = currentTheme === theme.id
                      return (
                        <button
                          key={theme.id}
                          onClick={() => applyTheme(theme.id)}
                          className={`relative rounded-2xl border p-3 text-left transition-all ${
                            active
                              ? 'border-accent/40 bg-accent/10 shadow-[0_0_0_1px_rgba(var(--accent),0.12)]'
                              : 'border-border/60 bg-background-secondary/[0.78] hover:border-accent/20 hover:bg-surface/90'
                          }`}
                        >
                          <ThemeWorkbenchPreview theme={theme} className="mb-3 h-[92px]" />
                          <div className="truncate text-sm font-semibold text-text-primary">{theme.name}</div>
                          <div className="mt-0.5 text-[11px] text-text-muted">{theme.type}</div>
                          {active && (
                            <div className="absolute right-3 top-3 rounded-full bg-accent p-0.5 text-white shadow-lg">
                              <Check className="w-3 h-3" strokeWidth={3} />
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </section>

                <div className="space-y-5 min-w-0">
                  <section className="space-y-3">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-text-muted">
                      <ZoomIn className="w-3.5 h-3.5" />
                      {copy.scale}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {SCALE_PRESETS.map(scale => {
                        const active = Math.abs(zoomFactor - scale) < 0.01
                        return (
                          <button
                            key={scale}
                            onClick={() => applyUiScale(scale)}
                            className={`h-10 rounded-xl border text-sm font-semibold transition-all ${
                              active
                                ? 'border-accent/40 bg-accent/10 text-accent'
                                : 'border-border/60 bg-background-secondary/[0.78] text-text-secondary hover:text-text-primary hover:bg-surface/90'
                            }`}
                          >
                            {Math.round(scale * 100)}%
                          </button>
                        )
                      })}
                    </div>
                  </section>

                  <section className="space-y-3">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-text-muted">
                      <LayoutTemplate className="w-3.5 h-3.5" />
                      {copy.density}
                    </div>
                    <div className="space-y-2">
                      {LAYOUT_PRESETS.map(item => {
                        const active = editorConfig.layoutDensity === item.id
                        return (
                          <button
                            key={item.id}
                            onClick={() => applyLayoutDensity(item.id)}
                            className={`w-full rounded-2xl border px-4 py-3 text-left transition-all ${
                              active
                                ? 'border-accent/40 bg-accent/10'
                                : 'border-border/60 bg-background-secondary/[0.78] hover:border-accent/20 hover:bg-surface/90'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-text-primary">
                                  {t(item.nameKey, language)}
                                </div>
                                <div className="mt-1 text-[11px] text-text-muted leading-5">
                                  {t(item.detailKey, language)}
                                </div>
                              </div>
                              {active && (
                                <div className="shrink-0 rounded-full bg-accent/90 p-1 text-white">
                                  <Check className="w-3 h-3" strokeWidth={3} />
                                </div>
                              )}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
