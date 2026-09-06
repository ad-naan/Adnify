import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Palette, PanelsTopLeft, X } from 'lucide-react'
import { useStore, type ThemeName } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { saveEditorConfig } from '@renderer/settings'
import { themeManager } from '@renderer/config/themeConfig'
import { api } from '@/renderer/services/electronAPI'
import WorkbenchMiniature from './WorkbenchMiniature'
import { t, type TranslationKey } from '@shared/i18n'
import WorkbenchLayoutSettings from './WorkbenchLayoutSettings'
import { useDecorativeAnimations } from '@renderer/hooks/useDecorativeAnimations'
import './titlebar-controls.css'
import './appearance-panel.css'

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
    hasWorkspace,
  } = useStore(useShallow(state => ({
    language: state.language,
    currentTheme: state.currentTheme,
    setTheme: state.setTheme,
    editorConfig: state.editorConfig,
    setEditorConfig: state.set,
    hasWorkspace: Boolean(state.workspace?.roots.length),
  })))

  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'appearance' | 'workbench'>('appearance')
  const animate = useDecorativeAnimations()
  const triggerRef = useRef<HTMLButtonElement>(null)
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

    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus() }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', handleOutsideClick); document.removeEventListener('keydown', escape) }
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
    theme: t('skinPanel.theme', language),
    scale: t('skinPanel.pageScale', language),
    density: t('skinPanel.layout', language),
  }

  return (
    <div className="relative z-50" ref={panelRef}>
      <button ref={triggerRef} type="button" onClick={() => setOpen(value => !value)} className="titlebar-action" title={copy.title} aria-label={copy.title} aria-expanded={open} aria-controls="appearance-layout-panel"><Palette aria-hidden="true" /></button>
      <AnimatePresence>
        {open && <motion.div id="appearance-layout-panel" className="appearance-panel" role="region" aria-label={copy.title}
          initial={animate ? { opacity: 0, y: 5 } : false} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: animate ? 5 : 0 }} transition={{ duration: animate ? .12 : 0 }}>
          <header className="appearance-panel-header">
            <h2>{copy.title}</h2>
            <button type="button" className="appearance-icon-button" onClick={() => { setOpen(false); triggerRef.current?.focus() }} aria-label={t('workbench.closeAppearance', language)}><X size={15} /></button>
          </header>
          {hasWorkspace && <div className="appearance-panel-tabs" role="tablist" aria-label={copy.title}>
            {(['appearance', 'workbench'] as const).map(id => {
              const Icon = id === 'appearance' ? Palette : PanelsTopLeft
              return <button key={id} type="button" role="tab" id={`appearance-tab-${id}`} tabIndex={tab === id ? 0 : -1} aria-selected={tab === id} aria-controls={`appearance-content-${id}`} onClick={() => setTab(id)} onKeyDown={event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                const next = event.key === 'Home' ? 'appearance' : event.key === 'End' ? 'workbench' : id === 'appearance' ? 'workbench' : 'appearance'
                setTab(next); document.getElementById(`appearance-tab-${next}`)?.focus()
              }}><Icon size={14} />{t(`workbench.tab.${id}`, language)}</button>
            })}
          </div>}
          <div className="appearance-panel-scroll custom-scrollbar">
            <div role="tabpanel" id="appearance-content-appearance" aria-labelledby={hasWorkspace ? 'appearance-tab-appearance' : undefined} hidden={hasWorkspace && tab !== 'appearance'}>
              <div className="appearance-settings">
                <section className="appearance-section">
                  <div className="appearance-section-heading"><h3>{copy.theme}</h3><span>{themes.find(theme => theme.id === currentTheme)?.name}</span></div>
                  <div className="appearance-theme-options">
                    {themes.map(theme => <button key={theme.id} type="button" className="appearance-theme-option" aria-pressed={currentTheme === theme.id} onClick={() => applyTheme(theme.id)}>
                      <div className="appearance-theme-picture"><WorkbenchMiniature theme={theme} compact /></div>
                      <span className="appearance-theme-name"><span>{theme.name}</span>{currentTheme === theme.id && <Check size={12} />}</span>
                    </button>)}
                  </div>
                </section>
                <section className="appearance-section">
                  <div className="appearance-section-heading"><h3>{copy.scale}</h3><span className="appearance-value">{Math.round(zoomFactor * 100)}%</span></div>
                  <div className="appearance-segmented" aria-label={copy.scale}>
                    {SCALE_PRESETS.map(scale => <button key={scale} type="button" aria-pressed={Math.abs(zoomFactor - scale) < .01} onClick={() => applyUiScale(scale)}>{Math.round(scale * 100)}%</button>)}
                  </div>
                </section>
                <section className="appearance-section">
                  <div className="appearance-section-heading"><h3>{copy.density}</h3></div>
                  <div className="appearance-segmented appearance-density-options" aria-label={copy.density}>
                    {LAYOUT_PRESETS.map(item => <button key={item.id} type="button" aria-pressed={editorConfig.layoutDensity === item.id} onClick={() => applyLayoutDensity(item.id)}>
                      <span className="appearance-density-mark" data-density={item.id} aria-hidden="true"><i /><i /><i /></span>{t(item.nameKey, language)}
                    </button>)}
                  </div>
                  <p className="appearance-setting-hint">{t(LAYOUT_PRESETS.find(item => item.id === editorConfig.layoutDensity)?.detailKey || 'skinPanel.density.comfortableDetail', language)}</p>
                </section>
              </div>
            </div>
            {hasWorkspace && <div role="tabpanel" id="appearance-content-workbench" aria-labelledby="appearance-tab-workbench" hidden={tab !== 'workbench'}><WorkbenchLayoutSettings /></div>}
          </div>
        </motion.div>}
      </AnimatePresence>
    </div>
  )
}
