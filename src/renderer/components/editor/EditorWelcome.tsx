import type { ReactNode } from 'react'
import { Boxes, Command, FolderOpen, Network, Search, Settings, TerminalSquare, Workflow } from 'lucide-react'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'

export function EditorWelcome() {
  const language = useStore((state) => state.language)
  const currentTheme = useStore((state) => state.currentTheme)
  const setShowSettings = useStore((state) => state.setShowSettings)
  const artwork = currentTheme === 'dawn' ? '/brand/welcome/light.webp' : '/brand/welcome/dark.webp'

  const openQuickOpen = () => useStore.getState().setShowQuickOpen(true)
  const openCommandPalette = () => useStore.getState().setShowCommandPalette(true)

  return (
    <WelcomeWorkbench
      language={language}
      artwork={artwork}
      eyebrow={t('editorWelcome.eyebrow', language)}
      title={t('editorWelcome.title', language)}
      subtitle={t('editorWelcome.subtitle', language)}
      primaryIcon={<Search className="h-4 w-4" />}
      primaryLabel={t('editorWelcome.searchTitle', language)}
      secondaryIcon={<TerminalSquare className="h-4 w-4" />}
      secondaryLabel={t('editorWelcome.commandsTitle', language)}
      onPrimary={openQuickOpen}
      onSecondary={openCommandPalette}
      footer={
        <>
          <button onClick={openQuickOpen} className="adnify-welcome-secondary-button">
            <FolderOpen className="h-4 w-4" />
            <span>{t('editorWelcome.openRecentFile', language)}</span>
          </button>
          <button onClick={() => setShowSettings(true)} className="adnify-welcome-secondary-button">
            <Settings className="h-4 w-4" />
            <span>{t('settings', language)}</span>
          </button>
        </>
      }
    />
  )
}

interface WelcomeWorkbenchProps {
  language: Language
  artwork: string
  eyebrow: string
  title: string
  subtitle: string
  primaryIcon: ReactNode
  primaryLabel: string
  secondaryIcon: ReactNode
  secondaryLabel: string
  onPrimary: () => void
  onSecondary: () => void
  footer: ReactNode
}

function WelcomeWorkbench({
  language,
  artwork,
  eyebrow,
  title,
  subtitle,
  primaryIcon,
  primaryLabel,
  secondaryIcon,
  secondaryLabel,
  onPrimary,
  onSecondary,
  footer,
}: WelcomeWorkbenchProps) {
  return (
    <div className="adnify-editor-welcome h-full overflow-hidden bg-background text-text-primary">
      <WelcomeStyles rootClass="adnify-editor-welcome" />

      <main className="h-full overflow-y-auto custom-scrollbar">
        <section className="adnify-welcome-shell">
          <div className="adnify-welcome-card">
            <div className="adnify-welcome-main">
              <div className="adnify-welcome-copy">
                <p className="adnify-welcome-eyebrow">{eyebrow}</p>
                <h2 className="adnify-welcome-title">{title}</h2>
                <p className="adnify-welcome-subtitle">{subtitle}</p>

                <div className="adnify-welcome-actions">
                  <button className="adnify-welcome-primary-button" onClick={onPrimary}>
                    {primaryIcon}
                    <span>{primaryLabel}</span>
                  </button>
                  <button className="adnify-welcome-outline-button" onClick={onSecondary}>
                    {secondaryIcon}
                    <span>{secondaryLabel}</span>
                  </button>
                </div>
              </div>

              <WelcomeArtwork src={artwork} />
            </div>

            <FeatureGrid language={language} />

            <div className="adnify-welcome-bottom-row">
              <div className="adnify-welcome-footer-actions">{footer}</div>

              <div className="adnify-welcome-shortcuts">
                <ShortcutHint keys={['Ctrl', ',']} label={t('settings', language)} />
                <span className="h-1 w-1 rounded-full bg-text-muted/30" />
                <ShortcutHint keys={['F12']} label={t('editorWelcome.devTools', language)} />
                <span className="h-1 w-1 rounded-full bg-text-muted/30" />
                <span className="inline-flex items-center gap-1">
                  <Command className="h-3.5 w-3.5" />
                  {t('editorWelcome.commandHint', language)}
                </span>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

function WelcomeArtwork({ src }: { src: string }) {
  return (
    <div className="adnify-welcome-visual" aria-hidden="true">
      <div className="adnify-welcome-visual-glow" />
      <img src={src} alt="" draggable={false} />
      <div className="adnify-welcome-visual-fade" />
    </div>
  )
}

function FeatureGrid({ language }: { language: Language }) {
  return (
    <div className="adnify-welcome-feature-grid">
      <FeatureCard
        icon={<Workflow className="h-5 w-5" />}
        title={t('welcome.feature.visual.title', language)}
        subtitle={t('welcome.feature.visual.subtitle', language)}
      />
      <FeatureCard
        icon={<Network className="h-5 w-5" />}
        title={t('welcome.feature.connect.title', language)}
        subtitle={t('welcome.feature.connect.subtitle', language)}
      />
      <FeatureCard
        icon={<Boxes className="h-5 w-5" />}
        title={t('welcome.feature.modular.title', language)}
        subtitle={t('welcome.feature.modular.subtitle', language)}
      />
    </div>
  )
}

function FeatureCard({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  return (
    <div className="adnify-welcome-feature-card">
      <div className="adnify-welcome-feature-icon">{icon}</div>
      <div className="adnify-welcome-feature-text">
        <h4 className="adnify-welcome-feature-title">{title}</h4>
        <p className="adnify-welcome-feature-desc">{subtitle}</p>
      </div>
    </div>
  )
}

function ShortcutHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {keys.map((key) => (
        <kbd key={key} className="rounded border border-border bg-surface/60 px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
          {key}
        </kbd>
      ))}
      <span>{label}</span>
    </span>
  )
}

function WelcomeStyles({ rootClass }: { rootClass: string }) {
  return (
    <style>{`
      .${rootClass} {
        container-type: inline-size;
      }

      .${rootClass} .adnify-welcome-shell {
        width: 100%;
        max-width: 1200px;
        margin: 0 auto;
        padding: clamp(16px, 3cqw, 32px) clamp(24px, 5cqw, 48px);
        display: flex;
        flex-direction: column;
        min-height: 100%;
      }

      .${rootClass} .adnify-welcome-card {
        position: relative;
        display: flex;
        flex-direction: column;
        flex: 1;
      }

      .${rootClass} .adnify-welcome-main {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 32px;
        min-height: clamp(380px, 40cqw, 520px);
      }

      .${rootClass} .adnify-welcome-copy {
        flex: 1;
        max-width: 540px;
        position: relative;
        z-index: 2;
      }

      .${rootClass} .adnify-welcome-eyebrow {
        display: inline-block;
        font-size: 13px;
        font-weight: 700;
        color: rgb(var(--accent));
        margin-bottom: 12px;
        letter-spacing: 0.5px;
        text-transform: uppercase;
      }

      .${rootClass} .adnify-welcome-title {
        font-size: clamp(36px, 5cqw, 52px);
        font-weight: 800;
        line-height: 1.15;
        color: rgb(var(--text-primary));
        letter-spacing: -0.02em;
      }

      .${rootClass} .adnify-welcome-subtitle {
        margin-top: 18px;
        font-size: 16px;
        line-height: 1.6;
        color: rgb(var(--text-secondary));
        max-width: 480px;
      }

      .${rootClass} .adnify-welcome-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        margin-top: 36px;
      }

      .${rootClass} .adnify-welcome-primary-button,
      .${rootClass} .adnify-welcome-outline-button,
      .${rootClass} .adnify-welcome-secondary-button {
        display: inline-flex;
        min-width: 140px;
        height: 46px;
        align-items: center;
        justify-content: center;
        gap: 10px;
        border-radius: 12px;
        padding: 0 24px;
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }

      .${rootClass} .adnify-welcome-primary-button {
        color: white;
        background: linear-gradient(135deg, rgb(var(--accent)), #8b5cf6);
        box-shadow: 0 8px 24px -8px rgba(var(--accent), 0.6);
        border: 1px solid rgba(255, 255, 255, 0.1);
      }
      
      .${rootClass} .adnify-welcome-primary-button:hover {
        transform: translateY(-2px);
        box-shadow: 0 12px 32px -8px rgba(var(--accent), 0.8);
        filter: brightness(1.05);
      }

      .${rootClass} .adnify-welcome-outline-button {
        border: 1px solid rgba(var(--border), 0.8);
        color: rgb(var(--text-primary));
        background: rgba(var(--surface), 0.5);
        backdrop-filter: blur(12px);
      }

      .${rootClass} .adnify-welcome-outline-button:hover {
        border-color: rgba(var(--accent), 0.5);
        background: rgba(var(--surface-hover), 0.8);
        transform: translateY(-2px);
      }

      .${rootClass} .adnify-welcome-secondary-button {
        height: 38px;
        min-width: auto;
        padding: 0 16px;
        border-radius: 10px;
        font-size: 13px;
        border: 1px solid transparent;
        color: rgb(var(--text-secondary));
        background: rgba(var(--surface), 0.3);
      }

      .${rootClass} .adnify-welcome-secondary-button:hover {
        color: rgb(var(--text-primary));
        background: rgba(var(--surface-hover), 0.6);
      }

      .${rootClass} .adnify-welcome-visual {
        flex: 1;
        position: relative;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        max-width: 600px;
        margin-right: -20px;
      }

      .${rootClass} .adnify-welcome-visual-glow {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 80%;
        padding-bottom: 80%;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        background: radial-gradient(circle, rgba(var(--accent), 0.12) 0%, transparent 70%);
        filter: blur(40px);
        z-index: 0;
      }

      .${rootClass} .adnify-welcome-visual img {
        position: relative;
        z-index: 1;
        width: 115%;
        max-width: 700px;
        height: auto;
        object-fit: contain;
        /* Magic mask to blend the solid background image into the app background */
        -webkit-mask-image: radial-gradient(ellipse 50% 50% at 50% 50%, black 60%, transparent 100%);
        mask-image: radial-gradient(ellipse 50% 50% at 50% 50%, black 60%, transparent 100%);
        animation: float 8s ease-in-out infinite;
        opacity: 0.95;
      }

      @keyframes float {
        0% { transform: translateY(0px) scale(1); }
        50% { transform: translateY(-12px) scale(1.02); }
        100% { transform: translateY(0px) scale(1); }
      }

      .${rootClass} .adnify-welcome-visual-fade {
        display: none;
      }

      .${rootClass} .adnify-welcome-feature-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 20px;
        margin-top: 40px;
        position: relative;
        z-index: 1;
      }

      .${rootClass} .adnify-welcome-feature-grid::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 100%;
        height: 140%;
        background: radial-gradient(ellipse at center, rgba(var(--accent), 0.35) 0%, transparent 70%);
        filter: blur(50px);
        transform: translate(-50%, -50%);
        z-index: -1;
        pointer-events: none;
      }

      .${rootClass} .adnify-welcome-feature-card {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 12px;
        padding: 20px;
        border-radius: 16px;
        background: linear-gradient(135deg, rgba(var(--text-primary), 0.08) 0%, rgba(var(--text-primary), 0.02) 100%);
        backdrop-filter: blur(32px) saturate(180%);
        -webkit-backdrop-filter: blur(32px) saturate(180%);
        border: 1px solid rgba(var(--text-primary), 0.08);
        box-shadow: 0 16px 40px rgba(0,0,0,0.15), inset 0 1px 1px rgba(var(--text-primary), 0.12);
        transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        position: relative;
        overflow: hidden;
      }

      .${rootClass} .adnify-welcome-feature-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(var(--accent), 0.5), transparent);
        opacity: 0;
        transition: opacity 0.3s ease;
      }

      .${rootClass} .adnify-welcome-feature-card:hover {
        transform: translateY(-4px);
        background: linear-gradient(135deg, rgba(var(--text-primary), 0.12) 0%, rgba(var(--text-primary), 0.04) 100%);
        border-color: rgba(var(--accent), 0.5);
        box-shadow: 0 20px 48px rgba(0,0,0,0.2), inset 0 1px 1px rgba(var(--text-primary), 0.2), 0 0 0 1px rgba(var(--accent), 0.15);
      }

      .${rootClass} .adnify-welcome-feature-card:hover::before {
        opacity: 1;
      }

      .${rootClass} .adnify-welcome-feature-icon {
        display: flex;
        width: 42px;
        height: 42px;
        flex-shrink: 0;
        align-items: center;
        justify-content: center;
        border-radius: 12px;
        color: rgb(var(--accent));
        background: linear-gradient(135deg, rgba(var(--accent), 0.15) 0%, rgba(var(--accent), 0.05) 100%);
        border: 1px solid rgba(var(--accent), 0.2);
        transition: transform 0.3s ease, background 0.3s ease;
      }

      .${rootClass} .adnify-welcome-feature-card:hover .adnify-welcome-feature-icon {
        transform: scale(1.05);
        background: linear-gradient(135deg, rgba(var(--accent), 0.25) 0%, rgba(var(--accent), 0.1) 100%);
      }

      .${rootClass} .adnify-welcome-feature-text {
        min-width: 0;
        flex: 1;
      }

      .${rootClass} .adnify-welcome-feature-title {
        font-size: 15px;
        font-weight: 600;
        color: rgb(var(--text-primary));
        margin: 0 0 6px 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        transition: color 0.3s ease;
      }

      .${rootClass} .adnify-welcome-feature-card:hover .adnify-welcome-feature-title {
        color: rgb(var(--accent));
      }

      .${rootClass} .adnify-welcome-feature-desc {
        font-size: 13px;
        color: rgb(var(--text-muted));
        line-height: 1.6;
        margin: 0;
        white-space: normal;
      }

      .${rootClass} .adnify-welcome-bottom-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        margin-top: auto;
        padding-top: 24px;
        padding-bottom: 12px;
        border-top: 1px solid rgba(var(--border), 0.3);
      }

      .${rootClass} .adnify-welcome-footer-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
      }

      .${rootClass} .adnify-welcome-shortcuts {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
        font-size: 12px;
        color: rgba(var(--text-muted), 0.8);
      }

      @container (max-width: 440px) {
        .${rootClass} .adnify-welcome-feature-grid {
          grid-template-columns: 1fr;
          max-width: 320px;
          margin-left: auto;
          margin-right: auto;
        }
      }

      @container (min-width: 441px) and (max-width: 900px) {
        .${rootClass} .adnify-welcome-feature-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @container (max-width: 900px) {
        .${rootClass} .adnify-welcome-title {
          font-size: clamp(26px, 4.5cqw, 36px);
        }

        .${rootClass} .adnify-welcome-subtitle {
          font-size: 14px;
        }

        .${rootClass} .adnify-welcome-actions {
          gap: 12px;
          margin-top: 24px;
        }

        .${rootClass} .adnify-welcome-primary-button,
        .${rootClass} .adnify-welcome-outline-button {
          min-width: 120px;
          padding: 0 16px;
          font-size: 13px;
        }
        
        .${rootClass} .adnify-welcome-feature-card {
          text-align: left;
        }
      }
    `}</style>
  )
}

