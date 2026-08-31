import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Folder, FolderOpen, History, Plus, Settings } from 'lucide-react'
import { api } from '@/renderer/services/electronAPI'
import { openFolderFromDialog, openWorkspaceFromDialog, openRecentWorkspace } from '@/renderer/services/workspaceOpenService'
import { useStore } from '@/renderer/store'
import { logger } from '@utils/Logger'
import { getFileName } from '@shared/utils/pathUtils'
import { t } from '@renderer/i18n'
import { publicAsset } from '@utils/publicAsset'
import UsageDashboard from './UsageDashboard'

interface RecentWorkspace {
  path: string
  name: string
}

export default function WelcomePage() {
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>([])
  const setShowSettings = useStore(s => s.setShowSettings)
  const language = useStore(s => s.language)
  const currentTheme = useStore(s => s.currentTheme)
  const welcomeArtwork = publicAsset(currentTheme === 'dawn' ? 'brand/welcome/light.webp' : 'brand/welcome/dark.webp')

  useEffect(() => {
    loadRecentWorkspaces()
  }, [])

  const loadRecentWorkspaces = async () => {
    try {
      const recent = await api.workspace.getRecent()
      setRecentWorkspaces(
        recent.slice(0, 8).map((path: string) => ({
          path,
          name: getFileName(path),
        }))
      )
    } catch (e) {
      logger.ui.error('[WelcomePage] Failed to load recent workspaces:', e)
    }
  }

  const handleOpenFolder = async () => {
    await openFolderFromDialog(language)
  }

  const handleOpenWorkspace = async () => {
    await openWorkspaceFromDialog(language)
  }

  const handleOpenRecent = async (path: string) => {
    await openRecentWorkspace(path, language)
  }

  return (
    <div className="adnify-welcome-page h-full w-full overflow-hidden bg-background text-text-primary">
      <WelcomeStyles rootClass="adnify-welcome-page" />

      <main className="h-full overflow-y-auto custom-scrollbar">
        <section className="adnify-welcome-shell">
          <div className="adnify-welcome-card">
            <div className="adnify-welcome-main">
              <div className="adnify-welcome-copy">
                <p className="adnify-welcome-eyebrow">{t('welcome.eyebrow', language)}</p>
                <h2 className="adnify-welcome-title">{t('welcome.title', language)}</h2>
                <p className="adnify-welcome-subtitle">{t('welcome.subtitle', language)}</p>

                <div className="adnify-welcome-actions">
                  <InteractiveIPButton
                    className="adnify-welcome-primary-button"
                    onClick={handleOpenFolder}
                    icon={<FolderOpen className="h-4 w-4" />}
                    label={t('welcome.openFolder', language)}
                    ipSrc={publicAsset('brand/ip/4.webp')}
                  />
                  <InteractiveIPButton
                    className="adnify-welcome-outline-button"
                    onClick={handleOpenWorkspace}
                    icon={<Folder className="h-4 w-4" />}
                    label={t('welcome.openWorkspace', language)}
                  />
                </div>
              </div>

              <WelcomeArtwork src={welcomeArtwork} />
            </div>

            <UsageDashboard language={language} />
          </div>

          <section className="adnify-welcome-recent">
            <div className="adnify-welcome-recent-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <h3>
                  <History className="h-4 w-4" />
                  {t('welcome.recent', language)}
                </h3>
                <span>{recentWorkspaces.length}/8</span>
              </div>
              <div className="adnify-welcome-footer-actions">
                <InteractiveIPButton
                  onClick={() => api.window.new()}
                  className="adnify-welcome-secondary-button"
                  icon={<Plus className="h-4 w-4" />}
                  label={t('welcome.newWindow', language)}
                  ipSrc={publicAsset('brand/ip/5.webp')}
                />
                <InteractiveIPButton
                  onClick={() => setShowSettings(true)}
                  className="adnify-welcome-secondary-button"
                  icon={<Settings className="h-4 w-4" />}
                  label={t('settings', language)}
                  ipSrc={publicAsset('brand/ip/6.webp')}
                />
              </div>
            </div>

            <div className="adnify-welcome-recent-list custom-scrollbar">
              {recentWorkspaces.length > 0 ? (
                recentWorkspaces.map((workspace) => (
                  <button
                    key={workspace.path}
                    onClick={() => handleOpenRecent(workspace.path)}
                    className="adnify-welcome-recent-item group"
                  >
                    <span className="adnify-welcome-recent-icon">
                      <Folder className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{workspace.name}</span>
                      <span className="block truncate font-mono text-[10px] text-text-muted/65">{workspace.path}</span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="adnify-welcome-empty-recent">{t('welcome.noRecentItems', language)}</div>
              )}
            </div>
          </section>
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
        flex: 1;
        display: flex;
        flex-direction: column;
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
        margin-top: 24px;
        font-size: 12px;
        color: rgba(var(--text-muted), 0.8);
      }
      
      .${rootClass} .adnify-welcome-recent {
        margin-top: auto;
        padding-top: 48px;
        max-width: 100%;
      }

      .${rootClass} .adnify-welcome-recent-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 24px;
        padding-bottom: 12px;
        border-bottom: 1px solid rgb(var(--border) / 0.5);
      }

      .${rootClass} .adnify-welcome-recent-header h3 {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        font-weight: 600;
        color: rgb(var(--text-primary));
      }

      .${rootClass} .adnify-welcome-recent-header span {
        font-size: 12px;
        color: rgba(var(--text-muted), 0.8);
      }

      .${rootClass} .adnify-welcome-recent-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 12px;
        max-height: 280px;
        overflow-y: auto;
      }

      .${rootClass} .adnify-welcome-recent-item {
        display: flex;
        align-items: center;
        gap: 14px;
        border-radius: 12px;
        padding: 12px;
        text-align: left;
        color: rgb(var(--text-secondary));
        background: rgba(var(--surface), 0.3);
        border: 1px solid rgba(var(--border), 0.4);
        transition: all 0.2s ease;
      }

      .${rootClass} .adnify-welcome-recent-item:hover {
        color: rgb(var(--text-primary));
        background: rgba(var(--surface-hover), 0.8);
        border-color: rgb(var(--accent) / 0.3);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.05);
      }

      .${rootClass} .adnify-welcome-recent-icon {
        display: flex;
        width: 36px;
        height: 36px;
        flex-shrink: 0;
        align-items: center;
        justify-content: center;
        border-radius: 10px;
        color: rgb(var(--text-muted));
        background: rgba(var(--text-primary), 0.05);
        transition: color 0.2s ease;
      }

      .${rootClass} .adnify-welcome-recent-item:hover .adnify-welcome-recent-icon {
        color: rgb(var(--accent));
        background: rgb(var(--accent) / 0.1);
      }
      
      .${rootClass} .adnify-welcome-empty-recent {
        grid-column: 1 / -1;
        display: flex;
        min-height: 120px;
        align-items: center;
        justify-content: center;
        border: 1px dashed rgba(var(--border), 0.8);
        border-radius: 12px;
        font-size: 13px;
        color: rgb(var(--text-muted));
        background: rgba(var(--surface), 0.2);
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
