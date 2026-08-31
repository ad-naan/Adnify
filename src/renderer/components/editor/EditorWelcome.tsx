import type { ReactNode } from 'react'
import { Command, FolderOpen, Search, Settings, TerminalSquare } from 'lucide-react'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'
import { publicAsset } from '@utils/publicAsset'
import UsageDashboard from '../welcome/UsageDashboard'

export function EditorWelcome() {
  const language = useStore((state) => state.language)
  const currentTheme = useStore((state) => state.currentTheme)
  const setShowSettings = useStore((state) => state.setShowSettings)
  const artwork = publicAsset(currentTheme === 'dawn' ? 'brand/welcome/light.webp' : 'brand/welcome/dark.webp')

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
          <InteractiveIPButton
            onClick={openQuickOpen}
            className="adnify-welcome-secondary-button"
            icon={<FolderOpen className="h-4 w-4" />}
            label={t('editorWelcome.openRecentFile', language)}
            ipSrc={publicAsset('brand/ip/5.webp')}
          />
          <InteractiveIPButton
            onClick={() => setShowSettings(true)}
            className="adnify-welcome-secondary-button"
            icon={<Settings className="h-4 w-4" />}
            label={t('settings', language)}
            ipSrc={publicAsset('brand/ip/6.webp')}
          />
        </>
      }
    />
  )
}

function InteractiveIPButton({
  icon,
  label,
  onClick,
  ipSrc,
  className
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  ipSrc?: string;
  className: string;
}) {
  return (
    <button className={`${className} group`} onClick={onClick}>
      <div className="relative z-10 flex items-center gap-2 pointer-events-none">
        {icon}
        <span>{label}</span>
      </div>
      {ipSrc && (
        <div className="adnify-welcome-button-mascot">
          <img src={ipSrc} alt="" draggable={false} />
        </div>
      )}
    </button>
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
                  <InteractiveIPButton
                    className="adnify-welcome-primary-button"
                    onClick={onPrimary}
                    icon={primaryIcon}
                    label={primaryLabel}
                    ipSrc={publicAsset('brand/ip/4.webp')}
                  />
                  <InteractiveIPButton
                    className="adnify-welcome-outline-button"
                    onClick={onSecondary}
                    icon={secondaryIcon}
                    label={secondaryLabel}
                  />
                </div>
              </div>

              <WelcomeArtwork src={artwork} />
            </div>

            <UsageDashboard language={language} />

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
        padding: clamp(20px, 3vh, 40px) clamp(24px, 5cqw, 48px);
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
        gap: 24px;
        min-height: clamp(220px, 28vh, 360px);
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
        font-size: clamp(28px, 4.5cqw, 42px);
        font-weight: 800;
        line-height: 1.15;
        color: rgb(var(--text-primary));
        letter-spacing: -0.02em;
      }

      .${rootClass} .adnify-welcome-subtitle {
        margin-top: 12px;
        font-size: 15px;
        line-height: 1.5;
        color: rgb(var(--text-secondary));
        max-width: 480px;
      }

      .${rootClass} .adnify-welcome-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        margin-top: 32px;
      }

      .${rootClass} .adnify-welcome-primary-button,
      .${rootClass} .adnify-welcome-outline-button,
      .${rootClass} .adnify-welcome-secondary-button {
        display: inline-flex;
        position: relative;
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
        overflow: visible;
      }

      .${rootClass} .adnify-welcome-primary-button {
        color: white;
        background: linear-gradient(135deg, rgb(var(--accent)), rgb(var(--accent-subtle)));
        box-shadow: 0 8px 24px -8px rgb(var(--accent) / 0.6);
        border: 1px solid rgba(255, 255, 255, 0.1);
      }
      
      .${rootClass} .adnify-welcome-primary-button:hover {
        transform: translateY(-2px);
        box-shadow: 0 12px 32px -8px rgb(var(--accent) / 0.8);
        filter: brightness(1.05);
      }

      .${rootClass} .adnify-welcome-outline-button {
        border: 1px solid rgba(var(--border), 0.8);
        color: rgb(var(--text-primary));
        background: rgba(var(--surface), 0.5);
        backdrop-filter: blur(12px);
      }

      .${rootClass} .adnify-welcome-outline-button:hover {
        border-color: rgb(var(--accent) / 0.5);
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

      /* IP Button Mascot Animations */
      .${rootClass} .adnify-welcome-primary-button:has(.adnify-welcome-button-mascot) {
        padding: 0 44px 0 20px;
      }
      .${rootClass} .adnify-welcome-secondary-button:has(.adnify-welcome-button-mascot) {
        padding: 0 40px 0 16px;
      }

      .${rootClass} .adnify-welcome-button-mascot {
        position: absolute;
        right: -8px;
        top: -16px;
        width: 48px;
        height: 48px;
        pointer-events: none;
        z-index: 20;
        opacity: 0.85;
        transform-origin: bottom center;
        transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
      }

      .${rootClass} .adnify-welcome-primary-button .adnify-welcome-button-mascot {
        width: 64px;
        height: 64px;
        top: -24px;
        right: -12px;
      }

      .${rootClass} .adnify-welcome-button-mascot img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        /* Feather out the edges to remove solid backgrounds */
        -webkit-mask-image: radial-gradient(circle at 50% 60%, black 30%, transparent 70%);
        mask-image: radial-gradient(circle at 50% 60%, black 30%, transparent 70%);
        transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
      }

      .${rootClass} .group:hover .adnify-welcome-button-mascot {
        transform: scale(1.3) translateY(-8px) rotate(-8deg);
        opacity: 1;
        filter: drop-shadow(0 8px 16px rgb(var(--accent) / 0.5));
      }

      .${rootClass} .group:hover .adnify-welcome-button-mascot img {
        -webkit-mask-image: radial-gradient(circle at 50% 50%, black 45%, transparent 80%);
        mask-image: radial-gradient(circle at 50% 50%, black 45%, transparent 80%);
        filter: saturate(1.2) brightness(1.1);
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
        background: radial-gradient(circle, rgb(var(--accent) / 0.12) 0%, transparent 70%);
        filter: blur(40px);
        z-index: 0;
      }

      .${rootClass} .adnify-welcome-visual img {
        position: relative;
        z-index: 1;
        width: 115%;
        max-width: 650px;
        max-height: 280px;
        height: auto;
        object-fit: contain;
        /* Magic mask to blend the solid background image into the app background */
        -webkit-mask-image: radial-gradient(ellipse 50% 50% at 50% 50%, black 60%, transparent 100%);
        mask-image: radial-gradient(ellipse 50% 50% at 50% 50%, black 60%, transparent 100%);
        animation: float 8s ease-in-out infinite;
        /* Promote to its own compositor layer so the masked image is rasterized
           once instead of every frame. */
        will-change: transform;
        opacity: 0.95;
      }

      /* translate-only keeps this on the compositor; adding scale() would force
         a re-raster of the mask + blurred glow on every frame. */
      @keyframes float {
        0% { transform: translateY(0px); }
        50% { transform: translateY(-12px); }
        100% { transform: translateY(0px); }
      }

      @media (prefers-reduced-motion: reduce) {
        .${rootClass} .adnify-welcome-visual img {
          animation: none;
          will-change: auto;
        }
      }

      .${rootClass} .adnify-welcome-visual-fade {
        display: none;
      }


      .${rootClass} .adnify-welcome-bottom-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-top: auto;
        padding-top: 16px;
        padding-bottom: 8px;
        border-top: 1px solid rgb(var(--border) / 0.3);
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
        color: rgb(var(--text-muted) / 0.8);
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
