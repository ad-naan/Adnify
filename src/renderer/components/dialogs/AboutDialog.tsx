/**
 * About Dialog
 * Shows app metadata, project links and contributors.
 */

import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Code2, ExternalLink, Github, Sparkles, X, Zap, BookOpen } from 'lucide-react'
import { CONTRIBUTORS, getCoreContributor } from '@shared/config/contributors'
import { t } from '@shared/i18n'
import { useStore } from '@store'
import { logger } from '@utils/Logger'
import { Modal } from '../ui'
import { Logo } from '../common/Logo'
import { ContributorGalaxy } from '../common/ContributorGalaxy'

interface AboutDialogProps {
  onClose: () => void
}

export default function AboutDialog({ onClose }: AboutDialogProps) {
  const language = useStore(s => s.language)
  const setShowChangelog = useStore(s => s.setShowChangelog)
  const [version, setVersion] = useState('1.0.0')
  const core = getCoreContributor()
  const contributorLabel = `${CONTRIBUTORS.length}+`

  useEffect(() => {
    const loadVersions = async () => {
      try {
        const appVersion = await window.electronAPI?.getAppVersion?.()
        if (appVersion) setVersion(appVersion)
      } catch (e) {
        logger.ui.error('Failed to get app version:', e)
      }
    }
    loadVersions()
  }, [])

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      noPadding
      size="4xl"
      showCloseButton={false}
      scrollable={false}
      className="adnify-about-modal bg-transparent border-0 shadow-none rounded-[24px]"
    >
      <AboutStyles />
      <motion.section
        className="adnify-about"
        initial={{ opacity: 0, y: 14, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.46, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="adnify-about-backdrop" />
        <div className="adnify-about-glow adnify-about-glow-1" />
        <div className="adnify-about-glow adnify-about-glow-2" />
        <div className="adnify-about-stars" aria-hidden="true" />

        <button
          type="button"
          onClick={onClose}
          className="adnify-about-close"
          aria-label={t('aboutDialog.close', language)}
        >
          <X className="w-4 h-4" />
        </button>

        <div className="adnify-about-shell">
          <div className="adnify-about-hero">
            <div className="adnify-about-brand-row">
              <span className="adnify-about-logo-wrap">
                <Logo className="adnify-about-logo" glow />
              </span>
              <div className="adnify-about-brand-meta">
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    setShowChangelog(true, version)
                  }}
                  className="adnify-about-version hover:ring-1 hover:ring-accent/50 cursor-pointer transition-all"
                  title={t('aboutDialog.viewChangelogForThis', language)}
                >
                  v{version}
                </button>
                <p className="adnify-about-eyebrow">{t('aboutDialog.aiNativeEditor', language)}</p>
              </div>
            </div>

            <div>
              <h1 className="adnify-about-title">Adnify</h1>
              <p className="adnify-about-subtitle">
                {t('aboutDialog.anEngineeringGradeAi', language)}
              </p>
            </div>

            <div className="adnify-about-chips" aria-label={t('aboutDialog.productCapabilities', language)}>
              <FeatureChip icon={Sparkles} label={t('aboutDialog.intelligent', language)} />
              <FeatureChip icon={Code2} label={t('aboutDialog.deepContext', language)} />
              <FeatureChip icon={Zap} label={t('aboutDialog.fastLoop', language)} />
            </div>

            <div className="adnify-about-actions">
              <button
                type="button"
                onClick={() => {
                  onClose()
                  setShowChangelog(true, version)
                }}
                className="adnify-about-link !bg-accent/15 !border-accent/30 !text-accent hover:!bg-accent/25 transition-all"
              >
                <BookOpen className="w-4 h-4" />
                <span>{t('aboutDialog.releaseNotes', language)}</span>
              </button>
              <SocialButton href="https://github.com/ad-naan/adnify" icon={Github} label="GitHub" />
              <SocialButton href="https://gitee.com/adnaan/adnify" icon={ExternalLink} label="Gitee" />
            </div>
          </div>

          <div className="adnify-about-community">
            <ContributorGalaxy language={language} scale={0.9} />
            <div className="adnify-about-community-copy">
              <p className="adnify-about-eyebrow adnify-about-eyebrow-success">
                {t('aboutDialog.communityBuilt', language)}
              </p>
              <h2>{t('aboutDialog.shapedByContributors', language)}</h2>
              <p>
                {t('aboutDialog.madePossibleByContributors', language, { count: contributorLabel })}
              </p>
            </div>
          </div>
        </div>

        <footer className="adnify-about-footer">
          <a href={core.url} target="_blank" rel="noreferrer" className="adnify-about-author">
            <img src={core.avatar} alt={core.name} draggable={false} />
            <span>
              <strong>{core.name}</strong>
              <small>{t('aboutDialog.creatorMaintainer', language)}</small>
            </span>
          </a>
          <p>Copyright © 2025-present adnaan. All rights reserved.</p>
        </footer>
      </motion.section>
    </Modal>
  )
}

function FeatureChip({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <span className="adnify-about-chip">
      <Icon className="w-3.5 h-3.5" />
      {label}
    </span>
  )
}

function SocialButton({ href, icon: Icon, label }: { href: string; icon: React.ElementType; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="adnify-about-link">
      <Icon className="w-4 h-4" />
      <span>{label}</span>
    </a>
  )
}

function AboutStyles() {
  return (
    <style>{`
      .adnify-about-modal {
        max-width: min(920px, calc(100vw - 32px));
      }

      .adnify-about {
        position: relative;
        min-height: 560px;
        overflow: hidden;
        border-radius: 24px;
        color: rgb(var(--text-primary));
        background: rgb(var(--surface) / 0.88);
        border: 1px solid rgb(var(--border) / 0.55);
        backdrop-filter: blur(26px);
        -webkit-backdrop-filter: blur(26px);
        box-shadow:
          0 30px 90px -32px rgb(0 0 0 / 0.42),
          0 1px 0 rgb(var(--text-primary) / 0.05) inset;
      }

      .adnify-about-backdrop {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(circle at 16% 12%, rgb(var(--accent) / 0.11), transparent 28%),
          radial-gradient(circle at 84% 24%, rgb(96 165 250 / 0.09), transparent 30%),
          linear-gradient(135deg, rgb(var(--surface) / 0.94), rgb(var(--surface-hover) / 0.70));
        pointer-events: none;
      }

      .adnify-about-stars {
        position: absolute;
        inset: 0;
        background-image:
          radial-gradient(rgb(var(--text-primary) / 0.08) 1px, transparent 1px),
          radial-gradient(rgb(var(--accent) / 0.12) 1px, transparent 1px);
        background-size: 38px 38px, 72px 72px;
        background-position: 0 0, 20px 30px;
        opacity: 0.36;
        animation: adnify-about-stars 18s linear infinite;
        pointer-events: none;
        -webkit-mask-image: radial-gradient(ellipse at center, black 20%, transparent 82%);
        mask-image: radial-gradient(ellipse at center, black 20%, transparent 82%);
      }
      @keyframes adnify-about-stars {
        0% { background-position: 0 0, 20px 30px; }
        100% { background-position: 76px 76px, 96px 106px; }
      }

      .adnify-about-glow {
        position: absolute;
        border-radius: 999px;
        filter: blur(72px);
        pointer-events: none;
      }
      .adnify-about-glow-1 {
        top: -160px;
        left: -140px;
        width: 420px;
        height: 420px;
        background: radial-gradient(circle, rgb(var(--accent) / 0.18), transparent 70%);
        animation: adnify-about-float-glow 18s ease-in-out infinite;
      }
      .adnify-about-glow-2 {
        right: -130px;
        bottom: -160px;
        width: 430px;
        height: 430px;
        background: radial-gradient(circle, rgb(var(--accent) / 0.10), transparent 70%);
        animation: adnify-about-float-glow 22s ease-in-out -8s infinite;
      }
      @keyframes adnify-about-float-glow {
        0%, 100% { transform: translate(0, 0) scale(1); }
        50% { transform: translate(34px, -26px) scale(1.08); }
      }

      .adnify-about-close {
        position: absolute;
        top: 18px;
        right: 18px;
        z-index: 5;
        width: 34px;
        height: 34px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 10px;
        color: rgb(var(--text-muted));
        background: rgb(var(--surface-hover) / 0.38);
        border: 1px solid rgb(var(--border) / 0.45);
        transition: all 0.2s ease;
      }
      .adnify-about-close:hover {
        color: rgb(var(--text-primary));
        background: rgb(var(--surface-hover) / 0.78);
        transform: translateY(-1px);
      }

      .adnify-about-shell {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: minmax(0, 0.95fr) minmax(330px, 1fr);
        gap: clamp(18px, 3vw, 34px);
        padding: clamp(34px, 5vw, 54px);
        padding-bottom: 28px;
        min-height: 480px;
      }

      .adnify-about-hero {
        min-width: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 20px;
        padding-left: 2px;
      }

      .adnify-about-brand-row {
        display: inline-flex;
        align-items: center;
        gap: 16px;
        width: fit-content;
        padding: 8px 14px 8px 8px;
        border-radius: 24px;
        background: linear-gradient(135deg, rgb(var(--surface) / 0.66), rgb(var(--surface-hover) / 0.34));
        border: 1px solid rgb(var(--border) / 0.42);
        box-shadow: 0 1px 0 rgb(var(--text-primary) / 0.04) inset;
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
      }

      .adnify-about-logo-wrap {
        position: relative;
        width: 72px;
        height: 72px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        border-radius: 20px;
        background: rgb(var(--surface-active) / 0.72);
        border: 1px solid rgb(var(--border) / 0.52);
        box-shadow:
          0 18px 42px -24px rgb(var(--accent) / 0.55),
          0 1px 0 rgb(var(--text-primary) / 0.05) inset;
      }
      .adnify-about-logo-wrap::before {
        content: '';
        position: absolute;
        inset: -14px;
        border-radius: inherit;
        background: radial-gradient(circle, rgb(var(--accent) / 0.25), transparent 68%);
        filter: blur(16px);
        z-index: -1;
      }
      .adnify-about-logo {
        width: 52px;
        height: 52px;
        object-fit: contain;
      }

      .adnify-about-brand-meta {
        display: grid;
        gap: 7px;
        justify-items: start;
        min-width: 0;
      }

      .adnify-about-version {
        display: inline-flex;
        align-items: center;
        width: fit-content;
        padding: 3px 10px;
        border-radius: 999px;
        font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
        font-size: 10px;
        font-weight: 700;
        color: rgb(var(--text-secondary));
        background: rgb(var(--surface) / 0.95);
        border: 1px solid rgb(var(--border));
        box-shadow: 0 8px 20px -12px rgb(0 0 0 / 0.45);
      }

      .adnify-about-eyebrow {
        margin: 0;
        font-size: 11px;
        font-weight: 800;
        color: rgb(var(--accent));
        letter-spacing: 0.6px;
        text-transform: uppercase;
      }
      .adnify-about-eyebrow-success {
        color: rgb(var(--status-success));
      }
      .adnify-about-title {
        margin: 0;
        font-size: clamp(50px, 6vw, 68px);
        line-height: 0.9;
        font-weight: 900;
        letter-spacing: 0;
        color: rgb(var(--text-primary));
      }
      .adnify-about-subtitle {
        max-width: 410px;
        margin: 18px 0 0;
        font-size: 14px;
        line-height: 1.65;
        font-weight: 500;
        color: rgb(var(--text-secondary));
      }

      .adnify-about-chips,
      .adnify-about-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
      }

      .adnify-about-chips {
        margin-top: 2px;
      }

      .adnify-about-actions {
        margin-top: 2px;
      }

      .adnify-about-chip,
      .adnify-about-link {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        height: 32px;
        padding: 0 12px;
        border-radius: 999px;
        color: rgb(var(--text-secondary));
        background: rgb(var(--surface-hover) / 0.52);
        border: 1px solid rgb(var(--border) / 0.5);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
      }
      .adnify-about-chip {
        font-size: 11px;
        font-weight: 700;
      }
      .adnify-about-chip svg,
      .adnify-about-link svg {
        color: rgb(var(--accent));
      }
      .adnify-about-link {
        font-size: 12px;
        font-weight: 800;
        transition: all 0.2s ease;
      }
      .adnify-about-link:hover {
        color: rgb(var(--text-primary));
        background: rgb(var(--accent) / 0.12);
        border-color: rgb(var(--accent) / 0.35);
        transform: translateY(-1px);
      }

      .adnify-about-community {
        position: relative;
        min-width: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        text-align: center;
        gap: 6px;
        min-height: 376px;
        border-radius: 20px;
        background: rgb(var(--surface) / 0.24);
        border: 1px solid rgb(var(--border) / 0.28);
        box-shadow: 0 1px 0 rgb(var(--text-primary) / 0.04) inset;
        overflow: hidden;
      }
      .adnify-about-community::before {
        content: '';
        position: absolute;
        inset: 0;
        background: radial-gradient(circle at 50% 42%, rgb(var(--accent) / 0.10), transparent 55%);
        pointer-events: none;
      }
      .adnify-about-community > * {
        position: relative;
        z-index: 1;
      }
      .adnify-about-community-copy {
        max-width: 420px;
        padding: 0 24px 18px;
      }
      .adnify-about-community-copy h2 {
        margin: 0 0 6px;
        font-size: 22px;
        line-height: 1.18;
        font-weight: 850;
        color: rgb(var(--text-primary));
      }
      .adnify-about-community-copy p:last-child {
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
        color: rgb(var(--text-secondary));
      }

      .adnify-about-footer {
        position: relative;
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        min-height: 74px;
        padding: 16px clamp(26px, 5vw, 54px);
        border-top: 1px solid rgb(var(--border) / 0.34);
        background: rgb(var(--surface) / 0.34);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
      }
      .adnify-about-author {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }
      .adnify-about-author img {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: 2px solid rgb(var(--surface));
        box-shadow: 0 0 0 1px rgb(var(--border));
      }
      .adnify-about-author span {
        display: grid;
        gap: 2px;
      }
      .adnify-about-author strong {
        font-size: 13px;
        font-weight: 800;
        color: rgb(var(--text-primary));
      }
      .adnify-about-author small {
        font-size: 10px;
        font-weight: 600;
        color: rgb(var(--text-muted));
      }
      .adnify-about-footer p {
        margin: 0;
        font-size: 10px;
        font-weight: 600;
        color: rgb(var(--text-muted) / 0.68);
        text-align: right;
      }

      @media (max-width: 760px) {
        .adnify-about {
          min-height: 0;
        }
        .adnify-about-shell {
          grid-template-columns: 1fr;
          padding: 34px 22px 20px;
        }
        .adnify-about-hero {
          align-items: center;
          text-align: center;
        }
        .adnify-about-brand-row {
          width: auto;
        }
        .adnify-about-brand-meta {
          justify-items: start;
          text-align: left;
        }
        .adnify-about-subtitle {
          max-width: 430px;
        }
        .adnify-about-chips,
        .adnify-about-actions {
          justify-content: center;
        }
        .adnify-about-community {
          min-height: 350px;
        }
        .adnify-about-footer {
          flex-direction: column;
          align-items: center;
          text-align: center;
        }
        .adnify-about-footer p {
          text-align: center;
        }
      }
    `}</style>
  )
}
